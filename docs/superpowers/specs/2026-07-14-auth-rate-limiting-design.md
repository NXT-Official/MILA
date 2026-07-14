# Mila Rate Limiting Architecture — Design Spec

**Status:** Approved for implementation planning, subject to verification of the existing database schema and Supabase OAuth client behavior.
**Author:** Claude + user
**Date:** 2026-07-14

---

## 1. Summary

Two facts shape this work:

1. Password login, signup, and Google OAuth currently call Supabase Auth directly from the browser through files under `src/components/login/*.tsx`, using the public anon or publishable key. Mila's server never sees these calls today.

2. Mila already has a durable Postgres rate limiter. Commit `fc4076a` added:

   - `public.rate_limit_buckets`
   - `check_rate_limit()`
   - Atomic upsert-based counter consumption
   - A `SECURITY DEFINER` implementation
   - Execution revoked from `anon` and `authenticated`
   - `src/lib/ai-rate-limit.server.ts`
   - Integration across all six AI endpoints

There is no production in-memory limiter left to replace.

The remaining work is therefore to generalize the existing Postgres rate-limiting primitive and extend it to authentication and other abuse-sensitive operations. This is not a greenfield store-selection task.

Repository inspection found no current Mila UI or active handlers for:

- Magic links
- Email OTP
- Phone OTP
- Password reset
- Verification resend
- MFA
- Anonymous authentication

The currently implemented authentication-related flows are:

- Password login
- Password signup
- Google OAuth
- Authenticated password reauthentication in the membership drawer
- Authenticated email change

Unused endpoint handlers must not be created solely to satisfy a theoretical checklist. Policy names and recommended controls for future flows may be reserved and documented so that future implementation must use the shared limiter.

---

## 2. Security Boundary

Moving password login, signup, and OAuth into Mila server routes guarantees that Mila's own first-party web application passes through Mila's application rate limiter.

It does not make Supabase Auth unreachable.

The Supabase project URL and anon or publishable key are public by design. A scripted caller can still invoke Supabase Auth directly without using Mila's server.

For example, an attacker may attempt to call Supabase's password-token or signup endpoints directly.

The design must therefore distinguish between two security layers.

### 2.1 Mila application-level controls

This task implements:

- Layered IP and account-based rate limits
- CAPTCHA escalation
- Shared counters across Mila application instances
- Generic public error responses
- Structured authentication telemetry
- Protection for Mila-owned operations
- AI cost controls
- Profile-write abuse controls
- Consistent handling of Mila and downstream Supabase throttling
- Safer first-party OAuth initiation and callback handling

### 2.2 Supabase-enforced controls

Supabase remains responsible for controls that must apply to callers who bypass Mila's application server.

Required Supabase-side protections include:

- Supabase Auth rate limits
- Supabase CAPTCHA enforcement
- OAuth and PKCE validation
- Provider-level email and SMS protections
- Any configured Auth Hooks
- Supabase account and project abuse protections

The final documentation must use this description:

> Mila's server-side authentication routes guarantee that Mila's first-party clients pass through Mila's application rate limiter. Direct Supabase Auth traffic remains governed by Supabase Auth's own rate limits, CAPTCHA, and any configured Auth Hooks.

The implementation and final report must never claim that Mila's proxy prevents all direct-to-Supabase authentication abuse.

---

## 3. Store Decision

### 3.1 Selected store

Postgres through Supabase.

### 3.2 Reasoning

Mila already has:

- A durable Postgres-backed limiter
- A rate-limit table
- An atomic database function
- A server-side TypeScript integration
- Six AI endpoints using the implementation
- No Redis or Upstash dependency
- Moderate expected authentication and AI traffic
- Full operational dependency on Supabase

Introducing Upstash now would add:

- Another external vendor
- Another production secret
- Another operational dependency
- Another billing surface
- Additional monitoring requirements
- Additional failure modes
- A second rate-limiting implementation to maintain

The existing Postgres design should be generalized rather than replaced.

### 3.3 Upstash reconsideration triggers

Reconsider Upstash or another Redis-compatible shared store if one or more of the following becomes true:

- Rate-limit traffic creates measurable Postgres pressure.
- Mila is deployed across many globally distributed regions.
- Authentication or AI volume grows substantially.
- Database connection pressure becomes operationally expensive.
- Rate-limit latency becomes material to user-facing requests.
- The application requires high-throughput sliding-window counters.
- Rate limiting must remain available during a Supabase Postgres outage.
- The expected request volume exceeds the practical throughput of the database design.

These triggers must be documented in:

```text
docs/security/RATE_LIMITING.md
```

---

## 4. Existing Database Convention

The existing implementation stores rate-limit buckets in:

```text
public.rate_limit_buckets
```

The table may remain in `public` for compatibility if all of the following are verified:

- Row Level Security is enabled.
- No user-facing policy grants access.
- Grants are revoked from `public`, `anon`, and `authenticated`.
- Users cannot read, insert, update, or delete counters.
- Access occurs only through narrowly scoped server-side operations.
- The table is not exposed through an unsafe view or function.
- Service-role use remains server-only.

The privileged function implementation should not remain directly in an exposed schema.

The revised design uses:

- A private privileged implementation
- A narrow public RPC wrapper only when required by PostgREST
- Explicit execution grants
- Migration assertions for privilege regression

---

## 5. Database Design

### 5.1 Batched atomic consumption

A single request-scoped database call must consume all applicable identifier scopes.

For example, one login request may consume:

- `login.ip`
- `login.ip_account`

The implementation must not call the database once per identifier.

Separate RPC calls would create:

- Multiple database round trips
- Partial consumption when a later call fails
- Ambiguous combined results
- Inconsistent retry metadata
- More difficult concurrency guarantees
- More complex failure handling

A representative TypeScript call is:

```ts
await consumeRateLimits({
  checks: [
    {
      policy: "login.ip",
      subjectHash: ipHash,
      limit: 20,
      windowSeconds: 600,
      cost: 1,
    },
    {
      policy: "login.ip_account",
      subjectHash: ipAccountHash,
      limit: 8,
      windowSeconds: 600,
      cost: 1,
    },
  ],
});
```

The database function must:

1. Validate the supplied JSON array.
2. Require at least one check.
3. Enforce a small maximum batch size, such as eight.
4. Validate every required field.
5. Reject duplicate `(policy, subject_hash)` pairs.
6. Sort keys deterministically before modifying rows.
7. Use database time rather than application-node time.
8. Consume all counters within one transaction.
9. Apply request cost atomically.
10. Return one result for every check.
11. Allow the caller to combine results using deny-wins semantics.
12. Return the longest applicable retry duration for denied checks.

The function must never accept:

- Table names
- Column names
- SQL fragments
- Sort expressions
- Arbitrary RPC names
- Arbitrary schema names
- User-controlled query syntax

---

### 5.2 Private privileged implementation

Create a private schema if one does not already exist:

```sql
create schema if not exists private;

revoke all on schema private
from public, anon, authenticated;
```

Create the privileged implementation under the private schema:

```sql
create or replace function private.consume_rate_limits(_checks jsonb)
returns table (
  policy text,
  allowed boolean,
  limit_value integer,
  remaining integer,
  reset_at timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * Implementation requirements:
   *
   * - Reject null input.
   * - Require a non-empty JSON array.
   * - Reject more than eight checks.
   * - Validate policy and subject_hash as non-empty strings.
   * - Validate limit, window_seconds, and cost as positive bounded integers.
   * - Reject duplicate policy and subject_hash combinations.
   * - Sort checks by policy and subject_hash before touching rows.
   * - Fully qualify public.rate_limit_buckets.
   * - Use clock_timestamp() for window calculations.
   * - Consume all counters within this function invocation.
   * - Return one row per supplied check.
   * - Use no dynamic SQL.
   */
end;
$$;

revoke execute
on function private.consume_rate_limits(jsonb)
from public, anon, authenticated;

grant usage on schema private
to service_role;

grant execute
on function private.consume_rate_limits(jsonb)
to service_role;
```

The implementation must:

- Use `SECURITY DEFINER`.
- Use `SET search_path = ''`.
- Fully qualify every referenced object.
- Validate all arguments.
- Reject excessive input.
- Avoid dynamic SQL.
- Avoid caller-selected database objects.
- Return only rate-limit decision data.
- Be inaccessible to ordinary Supabase roles.

---

### 5.3 Public PostgREST wrapper

If PostgREST RPC access requires a function in an exposed schema, add a narrow public wrapper with an explicit result shape:

```sql
create or replace function public.consume_rate_limits(_checks jsonb)
returns table (
  policy text,
  allowed boolean,
  limit_value integer,
  remaining integer,
  reset_at timestamptz,
  retry_after_seconds integer
)
language sql
security invoker
set search_path = ''
as $$
  select
    result.policy,
    result.allowed,
    result.limit_value,
    result.remaining,
    result.reset_at,
    result.retry_after_seconds
  from private.consume_rate_limits(_checks) as result;
$$;

revoke execute
on function public.consume_rate_limits(jsonb)
from public, anon, authenticated;

grant execute
on function public.consume_rate_limits(jsonb)
to service_role;
```

The private implementation and public wrapper must return exactly the same columns and compatible types.

The wrapper must:

- Use `SECURITY INVOKER`.
- Contain no dynamic SQL.
- Perform no independent authorization decisions.
- Delegate only to `private.consume_rate_limits(jsonb)`.
- Accept only the fixed rate-limit check structure.
- Be inaccessible to `public`, `anon`, and `authenticated`.
- Be executable only by the intended server-side role.

Add migration assertions:

```sql
do $$
begin
  if has_function_privilege(
    'anon',
    'public.consume_rate_limits(jsonb)',
    'EXECUTE'
  ) then
    raise exception
      'anon must not execute public.consume_rate_limits';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.consume_rate_limits(jsonb)',
    'EXECUTE'
  ) then
    raise exception
      'authenticated must not execute public.consume_rate_limits';
  end if;
end;
$$;
```

A future grant regression must fail migration verification or CI instead of silently reaching production.

---

### 5.4 Rate-limit bucket schema

The existing table is currently keyed by a single text key.

Migrate toward an explicit composite identity:

```text
(policy, subject_hash)
```

A representative schema is:

```sql
create table if not exists public.rate_limit_buckets (
  policy text not null,
  subject_hash text not null,
  request_count integer not null,
  window_start timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (policy, subject_hash)
);
```

The final migration must be based on the actual existing schema and preserve required existing AI-limit data or safely reset nonessential counters.

Requirements:

- `request_count` must never become negative.
- Policy and subject hash must be bounded in length.
- The table must not store raw email addresses or raw IP addresses.
- The table must not be readable or mutable by application users.
- Window calculations must use database time.
- Counter updates must be atomic.
- Cleanup must not be required for correctness.

Add an index supporting cleanup:

```sql
create index if not exists rate_limit_buckets_window_start_idx
on public.rate_limit_buckets (window_start);
```

A documented `pg_cron` job or equivalent cleanup task may remove expired rows older than the longest configured policy window.

---

## 6. Shared TypeScript Architecture

Create:

```text
src/lib/rate-limit/
  types.ts
  policies.ts
  identifiers.ts
  postgres-store.ts
  memory-store.ts
  limiter.server.ts
```

---

### 6.1 `types.ts`

Define common types:

```ts
export type RateLimitPolicyName =
  | "login.ip"
  | "login.ip_account"
  | "login.account_risk"
  | "signup.ip"
  | "signup.ip_account"
  | "oauth.start.ip"
  | "oauth.start.session_provider"
  | "oauth.callback.invalid_ip"
  | "oauth.callback.session"
  | "reauth.user"
  | "reauth.ip_user"
  | "email_change.user"
  | "email_change.ip"
  | "ai.outfit"
  | "ai.analysis"
  | "ai.concierge"
  | "ai.dupe_hunter"
  | "ai.personal_color"
  | "recovery.ip"
  | "otp.email.ip"
  | "otp.phone.ip"
  | "resend.ip_account"
  | "mfa.user_factor";
```

```ts
export type RateLimitCheck = {
  policy: RateLimitPolicyName;
  subjectHash: string;
  limit: number;
  windowSeconds: number;
  cost: number;
};
```

```ts
export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};
```

```ts
export type CombinedRateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  decisions: Array<{
    policy: RateLimitPolicyName;
    decision: RateLimitDecision;
  }>;
};
```

```ts
export type AuthRiskDecision =
  | {
      action: "allow";
    }
  | {
      action: "require_captcha";
    }
  | {
      action: "deny";
      retryAfterSeconds: number;
    };
```

Reserved future policy names must be clearly marked as having no active caller.

---

### 6.2 `policies.ts`

Create a typed policy registry.

Each policy must define:

- Policy name
- Limit
- Window duration
- Request cost
- Identifier scopes
- CAPTCHA behavior
- Store-failure behavior
- Safe public error message
- Logging severity
- Whether it represents attempts or confirmed failures

Do not scatter numeric limits across handlers.

Environment-based tuning must be validated using Zod during server startup.

Invalid production configuration must fail fast.

---

### 6.3 `identifiers.ts`

Provide:

- Email normalization
- Keyed HMAC pseudonymization
- IP normalization
- Trusted-proxy parsing
- IP and account compound identifiers
- User-scoped identifiers
- Provider and session identifiers
- Namespaced key generation

No rate-limit identifier may contain:

- Raw passwords
- Raw access tokens
- Raw refresh tokens
- Raw CAPTCHA tokens
- Raw OAuth codes
- Raw email addresses
- Raw phone numbers

---

### 6.4 `postgres-store.ts`

This is the production adapter.

It must:

- Make one batched RPC call.
- Apply a request timeout.
- Validate the RPC response with Zod.
- Reject malformed database results.
- Return typed decisions.
- Never accept a caller-selected RPC name.
- Never expose the privileged Supabase client.
- Never log the complete checks payload when it contains sensitive metadata.
- Produce safe structured store-error categories.

---

### 6.5 `memory-store.ts`

This adapter is for:

- Unit tests
- Explicit local development only

It must never be usable in production.

The production restriction is unconditional:

```ts
if (process.env.NODE_ENV === "production") {
  throw new Error(
    "Memory rate-limit storage cannot be used in production",
  );
}
```

Development opt-in is separate:

```ts
if (
  process.env.NODE_ENV !== "production" &&
  process.env.RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT !== "true"
) {
  throw new Error(
    "Memory rate-limit storage requires explicit development opt-in",
  );
}
```

Setting:

```text
RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT=true
```

must never make memory storage available in production.

---

### 6.6 `limiter.server.ts`

Provide the main server-only interface:

```ts
consumeRateLimits(checks)
```

It must:

- Resolve policy configuration centrally.
- Validate requested checks.
- Call the selected store once.
- Combine decisions using deny-wins semantics.
- Return the longest applicable retry duration.
- Apply each policy's documented store-failure behavior.
- Emit structured telemetry.
- Never return internal subject hashes to the browser.
- Never silently fail open.

---

### 6.7 Production store selection

There is no general production selector such as:

```text
RATE_LIMIT_STORE=postgres|memory|upstash
```

Postgres is the selected production store.

Production behavior:

- `PostgresRateLimitStore` is always used when `NODE_ENV === "production"`.
- Constructing or selecting `MemoryRateLimitStore` in production always throws.
- No environment variable may override this restriction.
- Tests explicitly inject `MemoryRateLimitStore`.
- Local development may use the memory adapter only after explicit non-production opt-in.

---

## 7. Safe Rate-Limit Identifiers

### 7.1 Email normalization

Normalize email addresses consistently:

```ts
const normalizedEmail = email.trim().toLowerCase();
```

Do not attempt provider-specific transformations such as removing dots or plus-addressing unless Mila explicitly defines and tests that behavior.

---

### 7.2 Keyed HMAC

Never store raw email addresses.

Use:

```text
HMAC-SHA-256(
  RATE_LIMIT_HMAC_SECRET,
  "email:" + normalizedEmail
)
```

A plain SHA-256 hash is not sufficient because common email addresses can be guessed offline.

Add:

```text
RATE_LIMIT_HMAC_SECRET=
```

The secret must be:

- High entropy
- Server-only
- Separate from all other secrets
- Absent from `VITE_*`
- Excluded from logs
- Excluded from client bundles

It must not be reused as:

- A Supabase key
- A JWT secret
- An hCaptcha secret
- An AI-provider key
- An OAuth secret
- A temporary handoff encryption key

---

### 7.3 Compound identifiers

Representative namespaces:

```text
ip:<ip-hmac>
email:<email-hmac>
ip_email:<compound-hmac>
user:<user-id-hmac>
ip_user:<compound-hmac>
provider_session:<compound-hmac>
```

Compound keys should be HMACed after constructing a canonical namespaced input.

---

## 8. Trusted Client IP Handling

Replace any implementation that blindly uses:

```ts
xForwardedFor.split(",")[0]
```

Add one trusted helper reused across the application.

Suggested configuration:

```text
RATE_LIMIT_TRUSTED_PROXY_COUNT=1
```

The helper must:

- Use a platform-provided verified client address where available.
- Read forwarding headers only when trusted proxies are configured.
- Select the correct address from the right side of the forwarding chain.
- Normalize IPv4 and IPv6.
- Reject malformed values.
- Avoid trusting arbitrary client-supplied forwarding headers.
- Handle missing addresses safely.
- Avoid logging complete IP addresses unless operationally required.
- Produce a stable fallback category when no trustworthy address exists.

The deployment checklist must specify the correct proxy count for the deployed infrastructure.

The shared helper should replace the existing naive parsing in `support.functions.ts` and any other duplicated client-IP logic.

---

## 9. Session Handoff for Server-Owned Authentication Routes

### 9.1 Decision

Use a transitional session handoff scoped minimally to this task.

The existing Mila session model remains unchanged for the rest of the application:

- Supabase browser session storage
- Existing local-storage behavior
- Bearer-token verification
- Existing authentication middleware
- Existing authenticated loaders
- Existing server functions
- Existing admin routes
- Existing onboarding
- Existing AI endpoints

A full `@supabase/ssr` cookie-session migration would change the application-wide session source of truth. That is a separate security architecture project and is outside this contained rate-limiting task.

The implementation must not put access or refresh tokens in query strings or URL fragments.

---

### 9.2 Password login and signup handoff

Password login and signup move behind Mila server functions.

Each server function:

1. Validates its input.
2. Applies Mila's rate limits.
3. Calls Supabase Auth using the anon or publishable credential.
4. Returns the successful session to Mila's first-party browser.
5. Adds `Cache-Control: no-store`.
6. Excludes credentials and sessions from telemetry.

The browser immediately calls:

```ts
await supabase.auth.setSession({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
});
```

This token-in-JSON handoff is transitional and must be documented as residual risk.

Required controls:

- Use `Cache-Control: no-store`.
- Never log access or refresh tokens.
- Never log complete sessions.
- Never include tokens in thrown errors.
- Never capture session responses through analytics or tracing.
- Never return raw Supabase errors.
- Send responses only over HTTPS in production.
- Prevent shared caching of authenticated responses.
- Record full cookie-backed SSR migration as a tracked follow-up.

---

### 9.3 OAuth initiation and PKCE storage

OAuth initiation and callback move to Mila-owned server routes.

The OAuth-start route uses a request-scoped Supabase client with cookie-backed PKCE storage.

The PKCE storage adapter must:

- Store the verifier in a short-lived cookie.
- Use `HttpOnly`.
- Use `Secure` in production.
- Use `SameSite=Lax`.
- Restrict the cookie path where practical.
- Avoid exposing the verifier to browser JavaScript.
- Never place the verifier in a URL.
- Remove the verifier after completion or expiry.

The OAuth-start route:

1. Validates the provider against a fixed allowlist.
2. Validates the post-login destination.
3. Applies OAuth-start rate limits.
4. Calls `signInWithOAuth`.
5. Persists PKCE state through the secure storage adapter.
6. Redirects to the provider authorization URL.

---

### 9.4 OAuth callback

The provider redirects to Mila's callback route with a one-time authorization code.

The callback route:

1. Validates the callback shape.
2. Uses the supported PKCE flow.
3. Validates the destination against an exact allowlist.
4. Calls `exchangeCodeForSession(code)`.
5. Creates a short-lived, single-use opaque handoff.
6. Redirects to a clean internal completion route.

Never place access or refresh tokens in:

- Query parameters
- URL fragments
- Redirect paths
- Browser history
- Logs
- Analytics
- Error messages

---

### 9.5 One-time OAuth session handoff

After the OAuth code exchange succeeds:

1. Generate a cryptographically random handoff token.
2. Store only a cryptographic hash of the token in Postgres.
3. Associate the temporary Supabase session with the handoff record.
4. Set the raw opaque token in a short-lived cookie.
5. Mark the cookie `HttpOnly`, `Secure`, and `SameSite=Lax`.
6. Redirect to a clean internal completion page.
7. Include no authorization code, access token, refresh token, or handoff token in the URL.
8. Have the completion page make a same-origin `POST` request.
9. Hash the cookie value on the server.
10. Find the matching unexpired handoff.
11. Atomically consume or delete the record.
12. Clear the handoff cookie.
13. Return the session with `Cache-Control: no-store`.
14. Have the browser immediately call `supabase.auth.setSession()`.
15. Reject every second redemption attempt.

The handoff should expire after approximately 60–120 seconds.

---

### 9.6 Handoff storage

Use a server-only table such as:

```text
private.auth_session_handoffs
```

A representative design is:

```sql
create table private.auth_session_handoffs (
  token_hash text primary key,
  encrypted_session_payload text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
```

The final implementation may adapt this schema, but it must provide:

- A hash of the handoff token
- No stored raw handoff token
- A protected session payload
- A short expiry
- Single-use redemption
- Atomic consumption
- Expired-record cleanup
- No direct browser access
- No ordinary-role grants

The session payload contains bearer credentials and must not be stored as unprotected plaintext available to ordinary database users.

Use a dedicated application-level encryption key or another reviewed protection mechanism.

Add a server-only secret such as:

```text
AUTH_HANDOFF_ENCRYPTION_KEY=
```

The encryption key must:

- Be high entropy
- Be server-only
- Be separate from the rate-limit HMAC secret
- Be separate from Supabase credentials
- Never use a `VITE_*` variable
- Never be logged
- Support documented rotation procedures

Implementation note: AES-256-GCM via Node/Bun's built-in `node:crypto` covers this without a new
dependency — no additional library is needed for authenticated encryption of the session payload.

---

### 9.7 Atomic handoff redemption

Handoff redemption must use one atomic database operation.

The operation must:

- Match the hashed token.
- Require `expires_at > clock_timestamp()`.
- Require `consumed_at is null`.
- Mark the record consumed or delete it.
- Return the protected session payload only when every condition succeeds.

A read followed by a separate update is not sufficient because concurrent requests could redeem the same handoff.

---

### 9.8 Fallback when handoff work is too large

If implementing the secure one-time handoff materially expands the rate-limiting task:

- Retain the current browser-owned OAuth session flow temporarily.
- Add Mila's OAuth-start rate-limit pre-check.
- Preserve Supabase's current browser PKCE and session behavior.
- Document the missing server-owned callback as residual risk.
- Create a separate tracked task for the one-time handoff or complete SSR migration.

Do not introduce a custom access-token or refresh-token transport through URL fragments.

---

### 9.9 Tracked SSR follow-up

A complete migration to `@supabase/ssr` remains a separate follow-up.

That migration should eventually update:

- Browser Supabase client creation
- Server Supabase client creation
- Authentication middleware
- Route loaders
- Server functions
- Admin routes
- Onboarding
- AI endpoints
- Session refresh
- Logout
- OAuth callback handling
- Authenticated response caching

---

## 10. Password Login

Create a server-side authentication function such as:

```text
loginWithPassword
```

Suggested location:

```text
src/lib/auth/login.functions.ts
```

### 10.1 Limits

Before calling Supabase, consume in one batch:

```text
login.ip
login.ip_account
```

Evaluate CAPTCHA escalation using:

```text
login.account_risk
```

Suggested initial values:

```text
login.ip:
  20 attempts per 10 minutes

login.ip_account:
  8 attempts per 10 minutes

login.account_risk:
  require CAPTCHA after 5 confirmed failures within 10 minutes
```

These are initial operational values and must be tuned using production metrics.

---

### 10.2 Attempt and failure semantics

Before calling Supabase, consume:

```text
login.ip
login.ip_account
```

These represent request attempts.

After a confirmed authentication failure, increment:

```text
login.account_risk
```

The risk counter must represent confirmed authentication failures rather than all attempts.

A successful login must not increase account-risk state.

Do not use `login.account_risk` as a hard account-only lock. An attacker must not be able to lock out another user simply by submitting that user's email address repeatedly.

It may be used for:

- CAPTCHA escalation
- Security telemetry
- Additional client delay
- Risk scoring

Do not reset broad IP counters after one successful login.

An implementation may reduce or expire an appropriate IP-account failure signal after a successful login, but it must not reset unrelated IP protection.

---

### 10.3 Supabase call

Use an anon-key or publishable-key Supabase client, not a service-role client.

Never use an administrative Auth method for ordinary password login.

Pass the CAPTCHA token through Supabase's supported password-login option when required by the current SDK and project configuration.

Verify the exact supported API shape during implementation.

---

### 10.4 Public responses

Do not distinguish publicly between:

- Unknown account
- Incorrect password
- Disallowed account state
- Suspended account when revealing that state would leak account existence

Return one generic message such as:

```text
Unable to sign in with those credentials.
```

When limited:

- Return HTTP `429 Too Many Requests`.
- Include `Retry-After`.
- Do not reveal which policy denied the request.
- Do not reveal whether the account exists.
- Do not automatically retry.

---

### 10.5 Downstream Supabase throttling

If Supabase returns `429`:

- Preserve the throttled outcome.
- Map it to Mila's generic public response.
- Honor provider retry metadata where available.
- Do not immediately retry.
- Record a safe structured event.
- Do not log raw Supabase response bodies containing sensitive context.

---

## 11. Signup

Create:

```text
signupWithPassword
```

Suggested location:

```text
src/lib/auth/signup.functions.ts
```

### 11.1 Limits

Consume in one batch before calling Supabase:

```text
signup.ip
signup.ip_account
```

Suggested starting values:

```text
signup.ip:
  5 attempts per 60 minutes

signup.ip_account:
  3 attempts per 24 hours
```

Signup fails closed when the rate-limit store is unavailable.

---

### 11.2 CAPTCHA

Signup always requires hCaptcha.

Pass the CAPTCHA token directly to Supabase's supported signup option:

```ts
await supabase.auth.signUp({
  email,
  password,
  options: {
    captchaToken,
  },
});
```

Do not independently verify the same token first and then pass it to Supabase. CAPTCHA tokens are generally single-use, and duplicate verification may invalidate or consume them.

The exact integration must be verified against the installed Supabase client version and deployed Auth configuration.

---

### 11.3 Generic response

Do not reveal whether the account already exists.

Use a generic response such as:

```text
If the address is eligible, check your email for the next step.
```

---

### 11.4 Profile initialization

Move the profile username or onboarding write out of the browser and into the controlled server-side signup workflow.

The profile update must be idempotent.

Do not claim that profile initialization is transactionally atomic with Supabase Auth account creation. Auth signup and the Mila profile update cross separate service boundaries and cannot normally share one application-controlled database transaction.

Preferred consistency options, in order:

1. Create the initial profile through a trusted database trigger attached to Auth user creation.
2. Use an idempotent server-side upsert after successful signup.
3. Record and retry incomplete profile initialization through a safe reconciliation process.

If an existing database trigger already creates the profile, the server function should update only explicitly allowed onboarding fields.

If required profile initialization fails:

- Log the partial failure without credentials or session data.
- Do not create duplicate profile rows on retry.
- Return a safe response that does not reveal whether the email existed.
- Allow onboarding to resume safely.
- Document the reconciliation path.

---

## 12. Supabase-Level Signup Enforcement

Because direct Supabase Auth calls remain possible, review whether a Supabase Before User Created Hook is appropriate and available.

The review must consider:

- Supabase plan availability
- Trustworthy client-IP availability
- Hook latency
- Failure behavior
- Account-creation outage risk
- Observability
- Shared rate-limit counter access
- Rollback procedures

Do not make Mila deployment dependent on an unavailable paid feature without documenting that dependency.

Supabase CAPTCHA and Auth rate limits remain mandatory even when Mila's server proxy is implemented.

---

## 13. OAuth Start

Create a Mila-owned OAuth-start route.

Suggested route:

```text
/auth/oauth/google
```

### 13.1 Flow

```text
Browser requests Mila OAuth-start route
        ↓
Mila validates provider
        ↓
Mila validates redirect destination
        ↓
Mila applies OAuth-start limits
        ↓
Mila creates the PKCE authorization request
        ↓
Mila stores PKCE state in secure cookie-backed storage
        ↓
Mila redirects to Google
```

### 13.2 Limits

Apply:

```text
oauth.start.ip
oauth.start.session_provider
```

Suggested starting values:

```text
oauth.start.ip:
  20 requests per 10 minutes

oauth.start.session_provider:
  8 requests per 10 minutes
```

### 13.3 Requirements

- Allow only configured providers.
- Permit only Google initially.
- Reject arbitrary provider names.
- Validate post-login destinations using an exact allowlist.
- Prefer hardcoded internal destinations.
- Reject protocol-relative destinations.
- Reject external redirects unless explicitly allowlisted.
- Preserve PKCE.
- Never log OAuth state.
- Never log the authorization code.
- Never log the PKCE verifier.
- Never expose provider tokens.
- Do not use Mila as an open redirector.

---

## 14. OAuth Callback

The existing callback route becomes server-owned.

Suggested route:

```text
/auth/callback
```

The callback must always enforce:

- PKCE through the supported Supabase flow
- One-time authorization-code exchange
- Exact redirect allowlisting
- Replay resistance
- Safe callback-parameter validation
- Generic errors
- No-store caching
- Secret and token redaction

Rate limiting applies primarily to failures:

```text
oauth.callback.invalid_ip
oauth.callback.session
```

Suggested initial values:

```text
oauth.callback.invalid_ip:
  10 failures per 10 minutes

oauth.callback.session:
  10 failures per 10 minutes
```

Do not apply a low hard IP limit to all successful callbacks. Legitimate users may share one office, school, household, mobile carrier, or VPN address.

Callback security must not depend on limiter availability:

- PKCE validation always runs.
- Authorization-code exchange validation always runs.
- Redirect validation always runs.
- Invalid callbacks always fail.
- A limiter-store outage never causes an invalid callback to be accepted.

On successful exchange, create the short-lived opaque handoff described in Section 9.

Redirect to a clean internal completion route containing:

- No authorization code
- No access token
- No refresh token
- No raw handoff token
- No user-controlled redirect destination

The completion route redeems the handoff through a same-origin `POST`.

If the secure one-time handoff is deferred, retain the existing browser-owned OAuth completion flow and document it as residual risk. Do not add URL-fragment token handoff.

---

## 15. Password Reauthentication

Move membership-drawer password reauthentication behind an authenticated Mila server function.

Suggested name:

```text
reauthenticateAndChangePassword
```

Requirements:

- Derive the current user from the verified authenticated session.
- Do not trust a client-supplied email address.
- Accept only the password and required operation input.
- Consume limits before password verification.
- Never log the password.
- Never use the password as a rate-limit identifier.
- Handle resulting session rotation safely.
- Return generic failures.

Apply:

```text
reauth.user
reauth.ip_user
```

Suggested starting values:

```text
reauth.user:
  5 attempts per 10 minutes

reauth.ip_user:
  8 attempts per 10 minutes
```

Fail closed on rate-limit store failure.

---

## 16. Email Change

Move email change behind an authenticated Mila server function.

Use a request-scoped user-context Supabase client:

```ts
await supabase.auth.updateUser({
  email: normalizedNewEmail,
});
```

Do not use a service-role administrative Auth method for self-service email changes.

Apply:

```text
email_change.user
email_change.ip
```

Suggested starting values:

```text
email_change.user:
  3 attempts per 60 minutes

email_change.ip:
  10 attempts per 60 minutes
```

Requirements:

- Derive the current user from the verified session.
- Normalize and validate the new email.
- Preserve Supabase's secure confirmation behavior.
- Return a generic public response.
- Do not log the raw new email.
- Record safe security telemetry.
- Fail closed when the limiter store is unavailable.

---

## 17. Authentication Flows Not Currently Present

The current repository has no active Mila UI or handler for:

- Magic links
- Email OTP
- Phone OTP
- Password recovery
- Verification resend
- MFA
- Anonymous authentication

Do not add dead handlers.

Instead:

- Reserve typed policy names.
- Document recommended policies.
- Require future flows to use the shared limiter.
- Add a code-review checklist item preventing unreviewed direct Auth calls.
- Add tests when each future flow is implemented.

Reserved names include:

```text
recovery.ip
otp.email.ip
otp.phone.ip
resend.ip_account
mfa.user_factor
```

---

## 18. CAPTCHA Escalation

The server computes authentication risk:

```ts
type AuthRiskDecision =
  | { action: "allow" }
  | { action: "require_captcha" }
  | {
      action: "deny";
      retryAfterSeconds: number;
    };
```

The client must not decide independently when CAPTCHA is required.

Required behavior:

- Signup always requires CAPTCHA.
- Login requires CAPTCHA after the configured confirmed-failure threshold.
- Future password-recovery and OTP flows should require CAPTCHA.
- CAPTCHA supplements rate limiting.
- CAPTCHA never replaces rate limiting.
- CAPTCHA tokens are never logged.
- Raw verification errors are not returned publicly.
- A valid CAPTCHA does not reset unrelated IP counters.

When CAPTCHA escalation is required, the login handler returns a safe response instructing the first-party UI to display the existing hCaptcha widget.

---

## 19. Initial Policies

| Policy | Identifier | Limit | Window | CAPTCHA | Store-failure behavior |
| --- | --- | ---: | ---: | --- | --- |
| `login.ip` | IP HMAC | 20 | 10 minutes | None initially | Bounded local emergency allowance and alert |
| `login.ip_account` | IP + account HMAC | 8 | 10 minutes | None initially | Bounded local emergency allowance and alert |
| `login.account_risk` | Account HMAC | 5 confirmed failures | 10 minutes | Required at threshold | Soft signal; must not hard-lock account alone |
| `signup.ip` | IP HMAC | 5 | 60 minutes | Always required | Fail closed |
| `signup.ip_account` | IP + account HMAC | 3 | 24 hours | Always required | Fail closed |
| `oauth.start.ip` | IP HMAC | 20 | 10 minutes | None | Fail closed or bounded emergency behavior |
| `oauth.start.session_provider` | Pre-auth session + provider | 8 | 10 minutes | None | Fail closed or bounded emergency behavior |
| `oauth.callback.invalid_ip` | IP HMAC | 10 failed callbacks | 10 minutes | None | Degraded counting only; callback still fails |
| `oauth.callback.session` | Pre-auth session | 10 failed callbacks | 10 minutes | None | Degraded counting only; validation always runs |
| `reauth.user` | User ID HMAC | 5 | 10 minutes | None | Fail closed |
| `reauth.ip_user` | IP + user HMAC | 8 | 10 minutes | None | Fail closed |
| `email_change.user` | User ID HMAC | 3 | 60 minutes | None | Fail closed |
| `email_change.ip` | IP HMAC | 10 | 60 minutes | None | Fail closed |
| `ai.outfit` | User ID HMAC, optional IP abuse scope | Existing value | Existing window | None | Fail closed |
| `ai.analysis` | User ID HMAC, optional IP abuse scope | Existing value | Existing window | None | Fail closed |
| `ai.concierge` | User ID HMAC, optional IP abuse scope | Existing value | Existing window | None | Fail closed |
| `ai.dupe_hunter` | User ID HMAC, optional IP abuse scope | Existing value | Existing window | None | Fail closed |
| `ai.personal_color` | User ID HMAC, optional IP abuse scope | Existing value | Existing window | None | Fail closed |

All numeric values are initial operational values and must be tunable based on production observations.

---

## 20. Store-Failure Behavior

Never silently catch a limiter error and allow unrestricted requests.

### 20.1 Fail closed

Fail closed for:

- Signup
- Password reauthentication
- Email change
- Future password recovery
- Future OTP sends
- Future confirmation resend
- Expensive AI operations

### 20.2 Password login

Use a small process-local emergency allowance only during durable-store failure.

Requirements:

- Small fixed count
- Short expiry
- Per-process scope clearly documented
- High-priority structured log
- Alerting
- No unlimited fail-open behavior
- Never used as the normal production limiter
- No configuration that silently enables it permanently

### 20.3 OAuth start

Fail closed or use the same strictly bounded emergency mechanism as password login.

### 20.4 OAuth callback

Cryptographic and protocol validation always runs regardless of limiter health.

If the shared store is unavailable while recording an invalid callback:

- The callback still fails.
- The failed attempt may not be counted.
- A degraded-enforcement event is logged.
- PKCE and redirect validation are never skipped.

A callback that has already passed protocol validation may proceed according to the documented callback policy.

### 20.5 Store timeout

`postgres-store.ts` must apply:

```text
RATE_LIMIT_STORE_TIMEOUT_MS
```

A slow database must not hang authentication requests indefinitely.

---

## 21. AI Limiter Migration

All six existing AI endpoints must move from hand-built keys and `src/lib/ai-rate-limit.server.ts` to the shared rate-limit abstraction.

Affected features include:

- Outfit generation
- Analysis
- Concierge
- Dupe hunter
- Personal color analysis
- The sixth currently protected AI route found during implementation

Requirements:

- Preserve existing numeric limits unless review identifies a defect.
- Move policy definitions into `policies.ts`.
- Use authenticated user ID as the primary subject.
- Add an IP abuse scope where account creation could bypass user quotas.
- Consume quota before calling the AI provider.
- Keep consumption atomic.
- Return `429`.
- Include `Retry-After`.
- Keep counters inaccessible to users.
- Never log complete AI prompts or responses.
- Document quota-refund behavior.

`src/lib/ai-rate-limit.server.ts` should either:

- Become a temporary compatibility wrapper, or
- Be removed after all call sites migrate

No second independent limiter architecture should remain.

---

## 22. Response Behavior

When Mila denies a request:

- Return `429 Too Many Requests`.
- Include `Retry-After`.
- Return a generic body.
- Do not reveal which identifier was limited.
- Do not reveal internal subject hashes.
- Do not expose policy implementation details.
- Do not reveal whether an account exists.

Example:

```json
{
  "error": "Too many attempts. Please try again later."
}
```

The client must:

- Avoid automatic retry loops.
- Disable submission until the known retry time when appropriate.
- Preserve accessibility.
- Show a clear temporary-throttling message.
- Avoid rendering raw Supabase errors.
- Distinguish throttling from a general network failure without exposing account state.

---

## 23. Logging and Telemetry

Record structured security events containing:

- Policy name
- Allowed or denied
- Pseudonymous subject identifier
- Request ID
- Endpoint category
- Store latency
- Store error category
- Retry duration
- CAPTCHA escalation
- Downstream Supabase `429`
- OAuth provider name where safe
- Deployment instance identifier where useful

Do not record:

- Passwords
- Raw email addresses
- Phone numbers
- Raw IP addresses unless strictly required
- OAuth authorization codes
- OAuth state
- PKCE verifiers
- Access tokens
- Refresh tokens
- CAPTCHA tokens
- Raw handoff tokens
- Complete session payloads
- AI prompts
- AI responses containing personal data

Avoid high-cardinality monitoring dimensions based on individual users, emails, IP addresses, or subject hashes.

---

## 24. Testing

Use the existing test framework. If none exists, add the smallest appropriate test setup.

### 24.1 Adapter contract tests

Run the same contract suite against:

- `MemoryRateLimitStore`
- `PostgresRateLimitStore`

Test:

- First request allowed
- Final permitted request allowed
- First over-limit request denied
- Correct remaining value
- Correct reset time
- Correct retry duration
- Expired window reset
- Cost greater than one
- Independent policies remain isolated
- Independent subjects remain isolated
- Invalid configuration rejected
- Empty batch rejected
- Excessive batch rejected
- Duplicate policy and subject pairs rejected
- Malformed database response rejected

---

### 24.2 Concurrency tests

Against a real Postgres environment, prove:

- Accepted requests never exceed the limit.
- Two limiter instances share the same counters.
- Batched consumption is atomic.
- No read-modify-write race exists.
- No partial multi-identifier consumption occurs.
- Deterministic key ordering avoids deadlocks.
- Cost-based consumption remains correct under concurrency.

If the execution environment has no Supabase CLI, Docker, or test database:

- Write the integration tests.
- Mark them as requiring a configured database.
- Document the exact execution command.
- Do not claim they passed.
- Add them to CI or deployment verification where Postgres is available.

---

### 24.3 Login tests

Test:

- Normal login succeeds.
- Repeated failures are limited.
- Unknown account and incorrect password return equivalent public errors.
- Email capitalization does not bypass limits.
- Changing account names does not bypass the IP limit.
- Account-risk state increases only for confirmed failures.
- Successful login does not increase account-risk state.
- CAPTCHA escalation occurs at the configured threshold.
- Valid CAPTCHA does not reset unrelated IP limits.
- Supabase `429` maps safely.
- Password is absent from logs.
- Tokens are absent from errors and telemetry.
- Successful responses use `Cache-Control: no-store`.

---

### 24.4 Signup tests

Test:

- Valid signup succeeds.
- Repeated attempts are limited.
- Email capitalization does not bypass the limit.
- Two application instances share counters.
- CAPTCHA failure blocks signup.
- Duplicate signup does not reveal account existence.
- Repeated requests do not create duplicate profile rows.
- Partial profile initialization is idempotent.
- Profile initialization is not falsely described as transactionally atomic.
- Direct Supabase bypass risk is documented and covered by Supabase-side controls.

---

### 24.5 OAuth tests

Test:

- Supported provider starts correctly.
- Unsupported providers are rejected.
- Repeated OAuth starts are limited.
- Invalid redirect destinations are rejected.
- Protocol-relative redirects are rejected.
- Missing callback code fails.
- Invalid state fails.
- Invalid PKCE state fails.
- Replayed authorization code fails.
- Failed callbacks are limited.
- Valid users sharing one IP are not incorrectly blocked.
- Authorization codes are absent from logs.
- OAuth state is absent from logs.
- PKCE verifier is absent from logs.
- Session responses use `Cache-Control: no-store`.
- No access or refresh token appears in a URL.
- Opaque handoffs expire.
- Opaque handoffs are single-use.
- Concurrent handoff redemption succeeds only once.
- Raw handoff tokens are not stored in Postgres.

---

### 24.6 Client-IP tests

Test:

- Direct connection
- One trusted proxy
- Multiple trusted proxies
- Spoofed `X-Forwarded-For`
- IPv4
- IPv6
- Missing IP
- Malformed forwarding values
- Incorrect proxy count
- Untrusted forwarding header
- Stable fallback behavior

---

### 24.7 Store-failure tests

Test:

- Postgres timeout
- Postgres unavailable
- Malformed RPC response
- Signup fails closed
- AI requests fail closed
- Reauthentication fails closed
- Email change fails closed
- Login uses only the documented emergency allowance
- Emergency allowance expires
- No unlimited fail-open path exists
- OAuth callback still performs PKCE and redirect validation
- Degraded callback counting is logged

---

### 24.8 Memory-store tests

Test:

- Memory adapter works in explicit test mode.
- Memory adapter requires development opt-in outside tests.
- Memory adapter always throws in production.
- `RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT=true` cannot override the production prohibition.

---

### 24.9 Database privilege tests

Verify:

- `anon` cannot execute `public.consume_rate_limits(jsonb)`.
- `authenticated` cannot execute `public.consume_rate_limits(jsonb)`.
- Ordinary users cannot read `public.rate_limit_buckets`.
- Ordinary users cannot write `public.rate_limit_buckets`.
- Ordinary users cannot execute `private.consume_rate_limits(jsonb)`.
- Ordinary users cannot access `private.auth_session_handoffs`.
- Handoff redemption is server-only.
- Rate-limit RPC output exposes no stored identifiers beyond what the server requires.

---

## 25. Documentation Deliverables

Create or update:

```text
docs/security/RATE_LIMITING.md
docs/security/SECURITY_AUDIT.md
docs/security/DEPLOYMENT_SECURITY_CHECKLIST.md
.env.example
```

### 25.1 `RATE_LIMITING.md`

Document:

- Why Postgres was selected
- Why Upstash was not selected
- Upstash reconsideration triggers
- Existing rate-limiter history
- Database schema
- Batched RPC design
- Private implementation function
- Public wrapper
- Execution grants
- Policy registry
- Identifier derivation
- HMAC secret handling
- Trusted-proxy configuration
- Login behavior
- Signup behavior
- OAuth behavior
- CAPTCHA behavior
- Store-failure behavior
- Emergency login allowance
- AI integration
- Limit tuning
- False-positive handling
- Rollback plan
- Supabase Auth controls
- Direct Supabase bypass boundary
- Transitional token handoff risk
- Full SSR migration follow-up
- Handoff encryption and cleanup

---

### 25.2 `.env.example`

Include placeholders only:

```text
RATE_LIMIT_HMAC_SECRET=
RATE_LIMIT_TRUSTED_PROXY_COUNT=1
RATE_LIMIT_STORE_TIMEOUT_MS=1500
RATE_LIMIT_ALLOW_MEMORY_IN_DEVELOPMENT=false
AUTH_HANDOFF_ENCRYPTION_KEY=
```

Do not add Upstash variables because Upstash is not selected.

Do not include real secrets.

Do not add a global production flag that disables all limits.

---

## 26. Deployment Requirements

The deployment checklist must include:

- Apply the Supabase migration.
- Verify RLS on `public.rate_limit_buckets`.
- Verify ordinary-role table grants are revoked.
- Verify RPC execution grants.
- Verify private-schema access.
- Generate `RATE_LIMIT_HMAC_SECRET`.
- Generate `AUTH_HANDOFF_ENCRYPTION_KEY` if the OAuth handoff is implemented.
- Configure the trusted proxy count.
- Confirm the platform's forwarding-header behavior.
- Enable Supabase Auth CAPTCHA.
- Review Supabase Auth rate-limit settings.
- Review Auth Hook availability.
- Configure Google OAuth redirect URLs.
- Verify PKCE callback behavior.
- Ensure authentication responses use `Cache-Control: no-store`.
- Ensure tokens are excluded from logs and tracing.
- Enable alerts for limiter-store failures.
- Enable alerts for abnormal authentication `429` rates.
- Enable expired handoff cleanup.
- Run database concurrency tests.
- Run database privilege tests.
- Confirm production cannot initialize the memory adapter.
- Confirm access and refresh tokens never appear in redirect URLs.

---

## 27. Acceptance Criteria

The work is complete only when:

- Existing Postgres rate limiting is generalized.
- Multi-identifier checks are consumed atomically.
- Password login uses a Mila server boundary.
- Signup uses a Mila server boundary.
- Login has layered IP and account controls.
- Signup has layered limits and CAPTCHA.
- OAuth initiation is handled by a Mila server route or is explicitly documented as a scoped transitional pre-check.
- OAuth callback is server-owned when the secure handoff is implemented.
- OAuth uses PKCE and exact redirect validation.
- Password reauthentication is server-side and user-scoped.
- Email change is server-side using an authenticated user client.
- Raw email addresses are not stored as rate-limit keys.
- Raw IP addresses are not stored as rate-limit keys.
- Forwarding headers are not blindly trusted.
- Existing AI endpoints use the shared limiter.
- Production cannot silently use memory storage.
- Memory storage always throws in production.
- Store failures follow documented behavior.
- Supabase Auth rate limits and CAPTCHA are documented as mandatory controls.
- Documentation clearly states that direct Supabase Auth calls remain possible.
- The public rate-limit RPC uses a valid explicit PostgreSQL return type.
- The migration proves `anon` and `authenticated` cannot execute the RPC.
- OAuth access and refresh tokens never appear in query parameters or URL fragments.
- OAuth handoff tokens are opaque, short-lived, hashed at rest, and single-use.
- Handoff redemption is atomic.
- Temporary session payloads are protected from ordinary database access.
- OAuth completion responses use `Cache-Control: no-store`.
- Documentation does not claim profile initialization is transactionally atomic with Auth signup.
- Partial signup and profile initialization failures have an idempotent recovery path.
- Unit tests pass.
- Lint passes.
- Production build passes.
- Database tests run where a test Postgres environment is available.
- No command or test is reported as passing unless it actually ran successfully.

---

## 28. Final Implementation Report Format

### 28.1 Store decision

State that Postgres was selected and explain why.

### 28.2 Existing implementation discovered

Describe:

- `public.rate_limit_buckets`
- Existing database function
- Existing AI limiter
- Six protected AI endpoints
- Existing grants and RLS posture

### 28.3 Authentication architecture changes

List changes for:

- Password login
- Signup
- OAuth start
- OAuth callback
- Password reauthentication
- Email change

### 28.4 Security boundary

Clearly explain:

- What Mila's limiter protects
- What direct Supabase callers can bypass
- Which Supabase controls remain required

### 28.5 Policies

Provide a table containing:

- Policy
- Identifier
- Limit
- Window
- CAPTCHA behavior
- Store-failure behavior

### 28.6 Database changes

Describe:

- Batched atomic consumption
- Private implementation function
- Public wrapper
- Grants
- RLS
- Concurrency behavior
- Handoff storage if implemented

### 28.7 Modified files

Group by:

- Application code
- Database migrations
- Tests
- Configuration
- Documentation

### 28.8 Verification

Include exact commands and actual results:

```bash
bun install --frozen-lockfile
bun run lint
bun run build
bun test
# Database integration-test command
```

Do not claim success for commands that were not executed.

### 28.9 Deployment actions

List:

- Migration deployment
- Environment variables
- HMAC secret generation
- Handoff encryption-key generation
- Trusted proxy configuration
- Supabase Auth rate-limit configuration
- CAPTCHA configuration
- OAuth redirect configuration
- Monitoring and alerting
- Expired-record cleanup

### 28.10 Remaining risks

Include:

- Direct Supabase Auth bypass
- Supabase plan limitations for Auth Hooks
- Store outage risk
- False-positive risk
- Shared-network risk
- Postgres latency risk
- Production tuning requirements
- Transitional login and signup token handoff
- Deferred full SSR session migration
- Deferred server-owned OAuth callback when applicable
