# Mila Rate Limiting Architecture — Design Spec

Status: Approved for planning. Author: Claude + user, 2026-07-14.

## 1. Summary

Two facts shape this work:

1. Password login, signup, and Google OAuth currently call Supabase Auth **directly from the
   browser** (`src/components/login/*.tsx`) with the public anon key. Mila's server never sees
   these calls today.
2. Mila already has a durable Postgres rate limiter. Commit `fc4076a` added
   `public.rate_limit_buckets` + `check_rate_limit()` (atomic upsert, `SECURITY DEFINER`, grants
   revoked from `anon`/`authenticated`) and `src/lib/ai-rate-limit.server.ts`, wired into all six
   AI endpoints. **There is no production in-memory limiter left to replace** — the task is to
   generalize the existing Postgres primitive to auth and other abuse-prone operations, not pick
   a store from scratch.

Grep of the repo found **no magic-link, email/phone OTP, password-reset, resend-confirmation,
MFA, or anonymous-auth UI**. Only password login, password signup, Google OAuth, an authenticated
password-reauth (membership drawer), and an authenticated email-change flow exist. Building
handlers for flows with zero callers is out of scope (YAGNI); their policy names and limits are
reserved in `policies.ts` and documented so the next engineer who adds one of these flows has a
checklist and no excuse to bypass the shared limiter.

## 2. Security boundary (must be documented, not just implemented)

Moving login/signup/OAuth into Mila server routes makes **Mila's own first-party web app** pass
through Mila's limiter unconditionally. It does **not** make Supabase Auth itself unreachable —
the Supabase project URL and anon/publishable key are public by design, so a scripted attacker can
always call `POST https://<project>.supabase.co/auth/v1/token?grant_type=password` directly,
bypassing Mila entirely.

Two layers, stated explicitly in `RATE_LIMITING.md`:

- **Mila application-level controls** (this task): layered IP/account limits, CAPTCHA escalation,
  telemetry, shared counters across nodes, generic responses, protection for Mila-owned
  operations (AI cost, profile writes).
- **Supabase-enforced controls** (required, not replaced): Supabase Auth's own rate limits,
  Supabase-side CAPTCHA verification (Attack Protection dashboard setting), PKCE/OAuth state
  handling, provider email/SMS limits. `DEPLOYMENT_SECURITY_CHECKLIST.md` already flags enabling
  these — this task keeps that requirement and cross-references it.

Correct claim for the final docs: *"Mila's server-side authentication routes guarantee that
Mila's first-party clients pass through Mila's application rate limiter. Direct Supabase Auth
traffic remains governed by Supabase Auth's own rate limits, CAPTCHA, and any configured Auth
Hooks."* Never claim Mila's proxy prevents all direct-to-Supabase abuse.

## 3. Store decision: Postgres (generalize, don't replace)

Selected: **Postgres**, extending `public.rate_limit_buckets`/`check_rate_limit`.

Why: already the durable store for AI limiting, zero existing Redis/Upstash footprint, moderate
traffic, atomic-upsert primitive already proven in production code, and the app is fully
Supabase-dependent already (no benefit to a second vendor for moderate load).

Upstash reconsideration triggers (documented in `RATE_LIMITING.md`): measurable Postgres load from
limiter traffic, multi-region/edge deployment, request volume growth that stresses connection
pooling, need for shared-store availability during a Postgres outage, or need for sub-millisecond
sliding-window counters at high QPS. None are true today.

Table stays in `public` (matches existing convention — RLS on, grants revoked, service-role-only
access) rather than introducing a new `private` schema for the table itself. The new **function**
implementing multi-check atomic consumption is split private-impl/public-wrapper (below) since
that's where the real privilege boundary lives.

## 4. Database design — batched atomic multi-identifier consumption

Single request-scoped call replaces one-RPC-per-identifier. Reasoning: fewer round trips, no
partial consumption if a later identifier's call fails, one atomic decision, simpler retry
metadata.

### 4.1 Private implementation

```sql
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.consume_rate_limits(_checks jsonb)
returns table(policy text, allowed boolean, limit_value integer, remaining integer,
              reset_at timestamptz, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
-- validates: non-null, non-empty, <= 8 elements, each has policy/subject_hash/limit/
-- window_seconds/cost, no duplicate (policy, subject_hash) pairs, all numeric bounds > 0.
-- Sorts checks by (policy, subject_hash) before touching rows to fix lock-acquisition
-- order across concurrent multi-check requests and avoid deadlocks.
-- One INSERT ... ON CONFLICT DO UPDATE per check inside a single function invocation
-- (implicit transaction), using clock_timestamp() for window math (never
-- application-supplied time). Returns one row per check; the caller combines
-- (deny wins, retryAfterSeconds = max over denied checks).
$$;

revoke execute on function private.consume_rate_limits(jsonb) from public, anon, authenticated;
```

`_checks` is a `jsonb` array of `{policy, subject_hash, limit, window_seconds, cost}` — never SQL
fragments, table names, or column names. The function fully qualifies every object it touches
(`public.rate_limit_buckets`).

### 4.2 Public wrapper (PostgREST-reachable)

```sql
create or replace function public.consume_rate_limits(_checks jsonb)
returns setof private.consume_rate_limits
language sql
security invoker
set search_path = ''
as $$
  select * from private.consume_rate_limits(_checks);
$$;

revoke execute on function public.consume_rate_limits(jsonb) from public, anon, authenticated;
grant execute on function public.consume_rate_limits(jsonb) to service_role;
```

Migration includes assertions (`has_function_privilege('anon', ..., 'EXECUTE')` = false, same for
`authenticated`) so a future grant regression fails CI, not production.

### 4.3 `rate_limit_buckets` schema change

Existing table is keyed by a single `key text primary key`. Extend to `(policy, subject_hash)`
composite primary key so one row unambiguously belongs to one policy+subject, add `cost`-aware
`count`, keep `window_start`. Existing AI call sites migrate their hand-built key strings
(`ai:generateDailyLook:<userId>`) into `(policy: "ai.outfit", subject_hash: hmac(userId))`.

Index for cleanup stays on `window_start`. A documented (not required-for-correctness) `pg_cron`
cleanup job prunes rows older than the longest configured window, same as the existing residual
note in `SECURITY_AUDIT.md`.

## 5. Shared TypeScript architecture

```
src/lib/rate-limit/
  types.ts          — RateLimitPolicyName, RateLimitCheck, RateLimitDecision,
                       CombinedRateLimitDecision, AuthRiskDecision
  policies.ts        — typed policy registry, Zod-validated at startup, includes reserved
                       (unimplemented) policy names for OTP/magic-link/MFA with a comment
                       pointing here when someone builds those flows
  identifiers.ts     — clientIp() (trusted-proxy aware), hashIdentifier() (namespaced HMAC),
                       compound-key builders (ip, ipAccount, userScoped, providerSession)
  postgres-store.ts  — production adapter; one batched RPC call, request timeout, response
                       shape validation, never accepts a caller-supplied RPC/table name
  memory-store.ts    — dev/test-only; throws if constructed with NODE_ENV=production and
                       RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT is not explicitly "true"
  limiter.server.ts  — consumeRateLimits(checks): resolves policies, calls the store once,
                       applies each policy's documented failure behavior on store error,
                       emits structured telemetry, returns CombinedRateLimitDecision
```

`src/lib/ai-rate-limit.server.ts` is removed; its six call sites move to
`consumeRateLimits([{ policy: "ai.outfit", ... }])`. No second limiter implementation survives.

Production selection: no `RATE_LIMIT_STORE=postgres|memory` runtime switch. Production always
constructs `PostgresRateLimitStore`; the memory store is reachable only through a test-only import
path, and `limiter.server.ts` throws at module init if `NODE_ENV === "production"` and anything
tries to use it.

## 6. Session handoff for new server-owned auth routes (resolved)

**Decision: transitional handoff, scoped minimally.** The existing session model
(localStorage on the browser client, Bearer-token verification via `getClaims` in
`auth-middleware.ts`) stays exactly as it is for the rest of the app. A full `@supabase/ssr`
cookie-session migration would touch `client.ts`, `auth-middleware.ts`, `auth-attacher.ts`,
`use-auth.tsx`, and every existing authenticated server function — that's a session-architecture
rewrite, not a rate-limiting change, and it's explicitly out of scope for this task. It's recorded
as a tracked follow-up in `RATE_LIMITING.md`.

Concretely:

- **Login/signup server functions** return `{ session: { access_token, refresh_token,
  expires_at } }` in the response JSON only on success. Response carries
  `Cache-Control: no-store`. Tokens are never logged, never included in thrown errors, never
  captured in structured telemetry. The browser calls `supabase.auth.setSession(...)`
  immediately on receipt, matching how `onAuthStateChange` already drives `use-auth.tsx`.
- **OAuth start/callback** move to Mila-owned server routes using a request-scoped `createClient`
  (already a dependency — no `@supabase/ssr` needed) configured with a **custom cookie-backed
  storage adapter** (~20 lines: `getItem`/`setItem`/`removeItem` reading/writing a short-lived,
  `HttpOnly`, `Secure`, `SameSite=Lax` cookie via TanStack Start's request/response helpers). This
  is the same mechanism `@supabase/ssr` wraps, sized to exactly what's needed: the PKCE code
  verifier never reaches the browser or the URL. The callback route exchanges the code
  server-side, then hands the resulting session back to the browser via a **URL fragment**
  (`#access_token=...&refresh_token=...`, never sent to any server, never in logs, never in
  Referrer headers — the same technique Supabase's own implicit flow used), and a small client
  route reads `location.hash`, calls `setSession()`, and clears the hash before any further
  navigation or render.

This closes the two real gaps (PKCE verifier exposure, unrateLimitable OAuth initiation) without
rewriting session architecture. It's weaker than full SSR cookies only in that a XSS-abled
attacker could theoretically read `location.hash` during the brief window before it's cleared —
same residual exposure the transitional login/signup handoff already accepts, documented as such.

## 7. Per-endpoint design

### 7.1 Password login

New `loginWithPassword` server function (`src/lib/auth/login.functions.ts`).

- Consumes `login.ip` + `login.ip_account` via one `consumeRateLimits` call **before** calling
  Supabase.
- Calls `supabase.auth.signInWithPassword` using a plain anon-key client (not admin/service-role).
- On any failure (unknown account, wrong password, disallowed state), returns one generic message
  and increments `login.account_risk` (failure-only signal, used for CAPTCHA escalation and
  telemetry — never a hard per-account lock, so an attacker can't lock out a victim by supplying
  their email repeatedly).
- On success, does **not** reset `login.ip` or `login.ip_account` (a successful login must not
  reset broad IP counters). May reduce `login.account_risk` for that ip+account pair only.
- Preserves a Supabase `429` by mapping it to Mila's same generic `429` shape, honoring Supabase's
  `Retry-After` when present, never auto-retrying.
- Password never appears in the rate-limit identifier, logs, or thrown errors.

### 7.2 Signup

New `signupWithPassword` server function (`src/lib/auth/signup.functions.ts`).

- Consumes `signup.ip` + `signup.ip_account` before calling Supabase. Fails closed on store error.
- `captchaToken` passed straight through to `supabase.auth.signUp({ options: { captchaToken } })`
  — **not** independently re-verified via `verifyHcaptcha` first, since hCaptcha tokens are
  single-use and a second `siteverify` call would consume/invalidate it before Supabase's own
  check runs.
- Generic response regardless of whether the email already existed.
- Profile username write (currently a client-side `.update` after signUp) moves into the same
  server function, using the already-idempotent `UPDATE ... WHERE id = ...` — no new duplicate-row
  risk, but now happens atomically with signup rather than as a second client round trip that
  could silently fail.

### 7.3 OAuth start

New route (`src/routes/auth/oauth/$provider.tsx` or a server function invoked before navigation,
per implementation-plan detail) replacing the client's direct `signInWithOAuth` call.

- Validates `provider` against a fixed allowlist (`google` only, today).
- Validates the post-login destination against an exact allowlist (today: hardcoded
  `/dashboard`, not user-controlled — still worth a real check function since `next` becomes
  attacker-influenced the moment any dynamic destination is added later).
- Consumes `oauth.start.ip` + `oauth.start.session_provider` before generating the authorize URL.
- Generates the PKCE code verifier/challenge and authorize URL server-side via the request-scoped
  client described in §6, writes the verifier cookie, redirects to the provider.

### 7.4 OAuth callback

`src/routes/auth/callback.tsx` becomes server-owned.

- Always runs PKCE/state/replay validation and exact-redirect-allowlist checks regardless of
  limiter state — a store outage never causes an unvalidated callback to be treated as legitimate.
- Rate limiting applies to **failure modes**, not successful callbacks: `oauth.callback.invalid_ip`
  for malformed/missing-code requests, `oauth.callback.session` for repeated failures tied to the
  same pre-auth session cookie. A shared office network with one flaky user never blocks everyone
  else's valid callback.
- On success, exchanges the code, then hands off the session via the URL-fragment mechanism in
  §6.

### 7.5 Password reauthentication (membership drawer)

`changePassword` in `studio-membership-drawer.tsx` moves to a server function
(`reauthenticateAndChangePassword`). Derives the current user from the already-authenticated
server session (never trusts a client-supplied email) and consumes `reauth.user` +
`reauth.ip_user` before calling `signInWithPassword`.

### 7.6 Email change

`updateUser({ email })` moves to an authenticated server function using a request-scoped
user-context client (the caller's own JWT via `requireSupabaseAuth`, **not** the service-role
admin client — this is a self-service action, not an admin one). Consumes `email_change.user` +
`email_change.ip` first; generic response either way.

## 8. Policies (initial values — tunable, documented as such)

| Policy | Identifiers | Limit | Window | CAPTCHA | Store-failure behavior |
|---|---|---|---|---|---|
| `login.ip` | IP | 20 | 10 min | — | small bounded emergency allowance + alert |
| `login.ip_account` | IP + account HMAC | 8 | 10 min | — | same |
| `login.account_risk` | account HMAC | 5 confirmed failures → require CAPTCHA | 10 min | requires captcha at threshold | soft signal only — fails open to "allow" (never blocks alone) |
| `signup.ip` | IP | 5 | 60 min | required always | fail closed |
| `signup.ip_account` | IP + account HMAC | 3 | 24 h | required always | fail closed |
| `oauth.start.ip` | IP | 20 | 10 min | — | fail closed / emergency-limited |
| `oauth.start.session_provider` | pre-auth session + provider | 8 | 10 min | — | same |
| `oauth.callback.invalid_ip` | IP | 10 failures | 10 min | — | log + alert; crypto validation never skipped |
| `oauth.callback.session` | pre-auth session | 10 failures | 10 min | — | same |
| `reauth.user` | user ID | 5 | 10 min | — | fail closed |
| `reauth.ip_user` | IP + user ID | 8 | 10 min | — | fail closed |
| `email_change.user` | user ID | 3 | 60 min | — | fail closed |
| `email_change.ip` | IP | 10 | 60 min | — | fail closed |
| `ai.outfit`/`ai.analysis`/`ai.concierge`/`ai.dupe_hunter`/`ai.personal_color` | user ID (+ IP abuse limit) | unchanged from current values | unchanged | — | fail closed (existing behavior preserved) |

Reserved, undocumented-handler policy names for future flows (`recovery.ip`, `otp.email.ip`,
`otp.phone.ip`, `resend.ip_account`, `mfa.user_factor`) are declared in `policies.ts` with a
comment explaining they have no caller yet.

## 9. Identifiers & privacy

- `clientIp()`: reads `RATE_LIMIT_TRUSTED_PROXY_COUNT` (default `1`), takes the Nth-from-right
  entry of `x-forwarded-for`, platform-agnostic (no Vercel/Fly/Cloudflare-specific header
  assumed). Replaces the naive `.split(",")[0]` in `support.functions.ts` too — one helper, one
  call site pattern, reused everywhere `clientIp()` was hand-rolled before.
- Emails normalized (`trim().toLowerCase()`) then hashed: `HMAC-SHA-256(RATE_LIMIT_HMAC_SECRET,
  "email:" + normalized)`. Dedicated secret, server-only, never reused from
  `SUPABASE_SERVICE_ROLE_KEY`/JWT secret/`HCAPTCHA_SECRET`/AI key.
- No raw email, phone, or username ever becomes a stored key or a log field.

## 10. CAPTCHA escalation

`AuthRiskDecision = { action: "allow" } | { action: "require_captcha" } | { action: "deny",
retryAfterSeconds }`, computed server-side, never left to the client to decide. Signup already
always renders hCaptcha (stricter than "escalate after N failures" — kept as-is, no change
needed). Login escalation is new: after `login.account_risk` crosses its threshold, the login
handler returns a decision the client uses to show the (already-imported) `HCaptcha` widget and
require a token on the next attempt.

## 11. Store failure behavior

- Signup, reauth, email change: **fail closed**.
- Login: bounded process-local emergency allowance (small fixed count, short TTL, high-priority
  structured log, never the default path) rather than a full outage — documented explicitly.
- OAuth start: fail closed / same emergency mechanism as login.
- OAuth callback: cryptographic validation (PKCE/state/replay/redirect-allowlist) **always**
  runs regardless of limiter health; only the abuse-counting layer degrades. Concretely: if the
  store is unavailable when recording an *invalid* callback, the callback still fails (crypto
  validation already rejected it) — the store failure only means the failed attempt isn't counted
  toward `oauth.callback.*`, logged as a degraded-enforcement event. A callback that already
  passed crypto validation is never held back by a limiter-store failure — it proceeds, since it
  has independently proven legitimacy.
- `postgres-store.ts` enforces a request timeout (`RATE_LIMIT_STORE_TIMEOUT_MS`) so a slow DB
  never hangs an auth request indefinitely.

## 12. AI limiter migration

All six existing AI endpoints move from hand-built string keys through
`consumeRateLimit`/`ai-rate-limit.server.ts` onto `consumeRateLimits` with named policies in
`policies.ts`. Existing numeric limits preserved unless review finds a specific flaw. No behavior
change beyond the shared abstraction and the composite-key schema change in §4.3.

## 13. Testing

- Adapter contract tests run against both `memory-store.ts` and `postgres-store.ts` (the same
  suite, parameterized).
- Concurrency tests against real Postgres are written but **require a live Supabase/Postgres
  instance to execute** — this sandbox has no Docker/Supabase CLI (verified). Marked accordingly,
  matching the existing precedent in `SECURITY_AUDIT.md` AUDIT-002. Exact run command documented
  in `RATE_LIMITING.md`.
- Login/signup/OAuth/client-IP/store-failure unit tests per the categories in the original brief,
  run for real via `bun test`.
- No test is reported as passing unless it actually ran and passed.

## 14. Documentation deliverables

`docs/security/RATE_LIMITING.md` (new), `docs/security/SECURITY_AUDIT.md` (new findings appended),
`docs/security/DEPLOYMENT_SECURITY_CHECKLIST.md` (updated), `.env.example` (new placeholder vars:
`RATE_LIMIT_HMAC_SECRET`, `RATE_LIMIT_TRUSTED_PROXY_COUNT`, `RATE_LIMIT_STORE_TIMEOUT_MS`,
`RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT`). No Upstash variables added (Upstash not selected). No
global "disable all limits" flag.

## 15. Acceptance criteria

See original task brief's acceptance criteria — all apply, resolved per the decisions in this
document (Postgres over Upstash, transitional token handoff over full SSR migration, no handlers
built for auth flows with zero current callers).
