# Mila — Threat Model

Living document. Update when a new role, data type, or trust boundary is added.

## Assets

| Asset | Where it lives | Sensitivity |
|---|---|---|
| User accounts & sessions | Supabase Auth (`auth.users`), browser session storage | High |
| Public/private profile info | `public.profiles` | Medium (email lives only in `auth.users`, never copied into `profiles`) |
| Feed posts (visible) | `public.posts` | Medium |
| Hidden posts + moderation reason | `public.posts.hidden`, `.hidden_reason` | High |
| Support messages | `public.support_messages` | Medium (may contain user-submitted PII in free text) |
| Staff roles | `public.user_roles` | Critical |
| Suspension status | `public.profiles.suspended` | Critical |
| Subscription plan catalog | `public.subscription_plans` | Medium (pricing changes are business-sensitive, not secret) |
| Audit records | `public.staff_audit_log` | High (integrity, not secrecy) |
| AI usage / rate-limit counters | `public.rate_limit_buckets`, `public.user_entitlements.ai_credits` | Medium (cost control) |
| Uploaded images | Storage buckets `outfits` (public), `posts` (private) | Medium |
| Supabase credentials | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | Critical |
| AI provider credentials | `AI_API_KEY`, `CLOUDFLARE_API_TOKEN` | Critical |
| hCaptcha secret | `HCAPTCHA_SECRET` | Critical |
| Application configuration | env vars, `vite.config.ts` CSP | Medium |

## Trust boundaries

```
Browser ──HTTPS──▶ Mila server (TanStack Start / Nitro)
Mila server ──service-role / user-JWT──▶ Supabase (Postgres + Auth + Storage)
Browser ──publishable key + user JWT──▶ Supabase directly (RLS-enforced reads/writes)
Mila server ──API key──▶ AI provider (OpenAI-compatible), Cloudflare Workers AI
Mila server ──siteverify──▶ hCaptcha
Mila server ──fetch──▶ Open-Meteo (fixed public API, no auth)
Supabase Auth ──JWT──▶ Postgres RLS (auth.uid(), custom claims)
Public users ──route guards (UI only, not a boundary)──▶ staff-only server functions (real boundary: assertAdmin/assertPermission + RLS)
```

The browser talks to Supabase directly in several places (profile reads/writes, plan catalog reads, dupe-hunter product search). In every one of those paths, RLS + column grants are the actual authorization boundary — the app does not layer additional server-side checks in front of them, by design (see ROLE_PERMISSION_MATRIX.md).

## Attackers considered

- **Anonymous automated attacker** — scripts against public endpoints (signup, login, support form, public plan reads).
- **Authenticated malicious member** — valid session, tries to reach staff functions, other users' data, or forges request bodies (role, ownerId, etc.).
- **Suspended member with an existing session** — JWT issued before suspension; every sensitive path must re-check current state.
- **Moderator attempting administrator actions** — role-confusion/privilege-escalation attempts (role changes, suspension, plans, settings).
- **Compromised staff account** — credential theft; blast radius should be bounded by scope (moderator ≠ admin) and detectable via `staff_audit_log`.
- **Attacker with a stale JWT** — token still cryptographically valid after a role/suspension change; server functions must not trust embedded role claims.
- **Attacker manipulating direct Supabase REST/RPC calls** — bypasses the Mila UI/server entirely; RLS + function grants are the only defense here.
- **Attacker abusing AI requests for cost** — repeated/concurrent calls to expensive AI endpoints.
- **Attacker supplying malicious URLs/files/HTML/model input** — SSRF via image URLs, XSS via free-text fields, prompt injection via AI-adjacent content.

## Highest-impact abuse cases (status)

| # | Abuse case | Outcome |
|---|---|---|
| 1 | Member calls an admin server function directly | Denied — every admin/moderator function calls `assertAdmin`/`assertPermission` server-side before touching data ([admin.functions.ts](../../src/lib/admin.functions.ts), [subscription-plans.functions.ts](../../src/lib/subscription-plans.functions.ts)). |
| 2 | Moderator changes a member's role | Denied at three layers: `assertPermission` (moderator has no `roles.manage`), `manage_user_role`'s own actor check, and `EXECUTE` on that function is `service_role`-only. |
| 3 | User changes an object ID and reads another user's private data | `getMemberProfile`/`getFeed` scope by authenticated `userId`; RLS scopes `profiles`/`outfits`/`user_entitlements` rows to `auth.uid()`. |
| 4 | User reads hidden posts via direct Supabase API | Blocked by the `posts` RLS SELECT policy (`hidden = false OR auth.uid() = user_id`); only admin/moderator policies add `has_role` overrides. |
| 5 | User retrieves moderation reasons without permission | Same policy — the whole row (incl. `hidden_reason`) is invisible if the post is hidden and you're not staff/owner. |
| 6 | Browser bundle exposes the Supabase privileged key | Not found: `supabaseAdmin` only constructed in `client.server.ts`, imported only via dynamic `import()` inside server-function handlers; grep of `.output` build artifacts below confirms no service-role key string appears in client bundles. |
| 7 | Privileged backend client executes a user-controlled table/RPC name | Not found: every `supabaseAdmin.from(...)`/`.rpc(...)` call uses a hardcoded literal, never a client-supplied string. |
| 8 | Suspended user continues using an old session | Every server function goes through `requireSupabaseAuth`, which re-checks `profiles.suspended` from the database on each request — not from the JWT. See "Suspension & session freshness" below for residual risk. |
| 9 | Cross-site request hides a post / changes a plan | TanStack Start's `createCsrfMiddleware` is installed globally in `src/start.ts` for all server functions, moderator and admin included. |
| 10 | User-supplied URL reaches cloud metadata/localhost/private network | **Fixed this pass** — `analyzeOutfit`/`findDupes`/`analyzeClothing` previously accepted an arbitrary `https?://` `imageUrl` forwarded verbatim to the AI provider; now restricted to Mila's own Supabase Storage public-object URLs (`assertTrustedStorageImageUrl`). |
| 11 | Concurrent AI calls bypass a non-atomic quota | **Fixed this pass** — replaced the in-memory limiter with an atomic Postgres upsert (`check_rate_limit`), applied to every AI endpoint. |
| 12 | Malicious content reaches rendered HTML or AI-output rendering path | No `dangerouslySetInnerHTML` renders user or AI content anywhere in the app (only static asset was the theme-init script, now externalized); AI replies are rendered as plain React text, never as HTML. |
| 13 | Cache returns one user's private SSR response to another | **Fixed this pass** — global `Cache-Control: no-store` route rule in production. |
| 14 | Error handling leaks tokens/DB details/private records | Handlers throw generic `Error(...)` messages; the root error middleware (`src/start.ts`) renders a static error page and logs the real error server-side only. |

## Suspension & session freshness (design note)

Supabase JWTs are short-lived (default 1h) and `requireSupabaseAuth` re-reads `profiles.suspended` from Postgres on every server-function call — so a suspended account loses access to every Mila server function within, at most, one access-token lifetime, and immediately for any call made after suspension (the check is live, not cached). The two things this does **not** cover, both accepted as residual risk and documented in SECURITY_AUDIT.md:

1. A still-valid access token can keep reading directly from Supabase's REST API for tables where RLS doesn't itself check `suspended` (e.g. reading one's own already-visible posts). Suspension in this product only needs to block *Mila's own privileged/staff-adjacent operations and new writes*, not retroactively hide previously-visible own data — no broken behavior was found here.
2. There's no active session-revocation call (`auth.admin.signOut`) on suspend. Adding one is a small future improvement (see residual risks).
