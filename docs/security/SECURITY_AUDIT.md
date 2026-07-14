# Mila — Security Audit

Scope: full repository inspection (application code, database migrations, Storage config,
build/CI config) against OWASP Top 10:2025, ASVS 5.0.0 L2, and the Supabase/TanStack
Start/hCaptcha guidance referenced in the task brief. This audit found the existing
codebase already implements RLS, column-level grants, and server-side authorization
carefully in most places — the findings below are the gaps found on top of that baseline,
not a rewrite of it.

Assumptions made where the brief didn't specify (Rule 15):
- Rate limits (10–20 req/hour per AI endpoint, 5 support submissions per 10 min per IP) are
  reasonable starting points, not measured production numbers — tune with real data.
- "Application settings" and payments/billing do not exist in the product yet; nothing was
  built for them, per the brief.
- Client IP for the anonymous support-form rate limit is read from `x-forwarded-for`,
  assuming the production deployment sits behind a proxy that sets it. If that assumption
  is wrong in the actual hosting environment, the limiter still functions (falls back to a
  shared `"unknown"` bucket) but is less precise per-attacker.

---

## Fixed findings

### AUDIT-001 — User-controlled image URL forwarded to the AI provider (SSRF-adjacent)
- **OWASP Top 10:2025**: A10 Server-Side Request Forgery
- **ASVS**: V12 (File & Resources) / SSRF guidance
- **Severity**: High | **Confidence**: Medium (impact depends on the configured AI gateway's own fetch behavior)
- **Affected files**: `src/lib/analyze-outfit.functions.ts`, `src/lib/dupe-hunter.functions.ts`, `src/lib/analyze-clothing.functions.ts`
- **Attack scenario**: These three server functions accepted `imageUrl: z.string().url()` from an authenticated client and forwarded it verbatim as an `image_url` content part in the chat-completions request (`aiChatCompletion`). Many OpenAI-compatible gateways (self-hosted routers/proxies especially) fetch that URL server-side to view the image. A malicious `imageUrl` pointing at `http://169.254.169.254/...` or an internal service would cause the *AI provider's* infrastructure to fetch it — and if a gateway echoes fetch errors/content back, this could leak internal responses through the AI response.
- **Impact**: SSRF against the AI provider's network; potential internal data disclosure depending on gateway behavior.
- **Evidence**: Before the fix, `data.imageUrl` (Zod-validated only for URL *format*, any host) was passed straight into `image_url: { url: data.imageUrl } }`. `concierge-chat.functions.ts` already had the correct pattern (restrict to Mila's own storage prefix) for its look-image attachment — the other three endpoints didn't follow it.
- **Remediation**: Added `src/lib/trusted-image-url.server.ts` (`assertTrustedStorageImageUrl`), requiring the URL to start with `https://<SUPABASE_URL>/storage/v1/object/public/`. Applied to all three endpoints before the image is ever referenced in an AI request.
- **Implementation status**: Fixed.
- **Verification test**: `src/lib/trusted-image-url.server.test.ts` (6 cases: accepts own storage URL; rejects external host, metadata-style host, look-alike host, wrong path on the trusted host, and non-https scheme). `bun test` — all pass.
- **Residual risk**: None identified for this specific vector. Note this only restricts the URL *reference* — Mila's server itself never fetches the URL, so no additional outbound-fetch SSRF guard (DNS resolution/redirect revalidation) was needed here.

### AUDIT-002 — AI rate limiting was in-memory only, non-atomic, and per-instance
- **OWASP Top 10:2025**: A04 Insecure Design (missing anti-automation) / cost-abuse
- **ASVS**: V11 (Business Logic) — anti-automation controls
- **Severity**: High | **Confidence**: High
- **Affected files**: `src/lib/rate-limit.server.ts` (removed), `src/lib/generate-outfit.functions.ts`, `src/lib/analyze-outfit.functions.ts`, `src/lib/dupe-hunter.functions.ts`, `src/lib/analyzePersonalColor.functions.ts`, `src/lib/analyze-clothing.functions.ts`, `src/lib/concierge-chat.functions.ts`
- **Attack scenario**: The only rate limiter (`checkRateLimit`, used solely by `conciergeChat`) was a JS `Map` in server memory — explicitly documented in its own `ponytail:` comment as resetting on redeploy and not shared across instances. Four of the five other AI endpoints (`generateDailyLook`, `analyzeOutfit`, `findDupes`, `analyzeClothing`, `analyzePersonalColor`) had **no rate limit at all**, only a no-op credit check (`consumeAiCredit` returns `999` unconditionally — see AUDIT-010). A user (or a small botnet spreading requests across load-balanced instances) could call any of these in an unbounded loop, each call triggering a real AI-provider and (for outfit generation) Cloudflare Workers AI charge.
- **Impact**: Unbounded AI provider / Cloudflare cost exposure; potential denial-of-wallet.
- **Evidence**: `src/lib/credits.server.ts` — `consumeAiCredit` always returns `999`, no deduction. Only `concierge-chat.functions.ts` called any limiter before this fix.
- **Remediation**: Added migration `20260714090000_atomic_rate_limits.sql` — a `rate_limit_buckets` table plus a `SECURITY DEFINER` function `check_rate_limit(key, limit, window_seconds)` that performs a single atomic `INSERT ... ON CONFLICT DO UPDATE` (Postgres serializes concurrent upserts on the same key, so two simultaneous requests at the quota boundary cannot both pass). Added `src/lib/ai-rate-limit.server.ts` (`consumeRateLimit`) and wired it into all six AI-adjacent endpoints, each with a per-user, per-hour (or per-5-minutes for concierge) budget, consumed *before* the AI provider call. Deleted the now-unused in-memory limiter.
- **Implementation status**: Fixed.
- **Verification test**: Atomicity itself requires a live Postgres instance to exercise concurrently — not runnable in this sandbox (no Docker/Supabase CLI, verified via `docker info`/`supabase --version`, both absent). The SQL was reviewed by inspection for the single-statement-upsert property; `bun run build`/`tsc --noEmit` confirm the TypeScript call sites compile and unit-test-covered call contracts (`consumeRateLimit` throwing `RateLimitExceededError`) are exercised indirectly through the existing endpoint code paths. **Run a concurrency test against a local Supabase stack before relying on this in production** (see residual risks).
- **Residual risk**: Limits (10–20/hour, 5/10min) are placeholders, not tuned against real cost data. `rate_limit_buckets` rows are never pruned — not a correctness issue (keys are bounded by userId/IP) but worth a cleanup job eventually.

### AUDIT-003 — Anonymous support-message endpoint had no captcha or rate limit
- **OWASP Top 10:2025**: A04 Insecure Design / A10 SSRF n/a here — anti-automation gap
- **ASVS**: V11 — anti-automation for unauthenticated forms
- **Severity**: Medium | **Confidence**: High
- **Affected files**: `src/lib/support.functions.ts`, `src/components/login/support-dialog.tsx`
- **Attack scenario**: `submitSupportMessage` is unauthenticated by design (submitted from the pre-login page) and wrote directly to `support_messages` via the service role, with no hCaptcha check and no rate limit of any kind. A scripted attacker could flood the table or use it as a free-form spam/storage vector.
- **Impact**: Storage/spam abuse of an unauthenticated, service-role-backed write path; noisy/unusable support queue for staff.
- **Evidence**: Original handler took only `{ kind, message }`, validated by Zod length limits, and inserted immediately — no `verifyHcaptcha`, no rate check.
- **Remediation**: Added `src/lib/hcaptcha.server.ts` (`verifyHcaptcha`, calls hCaptcha's `siteverify` server-side, fails closed on any error, never logs the token) and wired it into `submitSupportMessage`, plus a per-IP atomic rate limit (5 per 10 minutes) via the same `check_rate_limit` primitive as AUDIT-002. Added the `HCaptcha` widget to `support-dialog.tsx`.
- **Implementation status**: Fixed.
- **Verification test**: `src/lib/hcaptcha.server.test.ts` (5 cases: missing token rejected without a network call; missing `HCAPTCHA_SECRET` fails closed; `success: false` rejected; network error fails closed; `success: true` accepted). `bun test` — all pass.
- **Residual risk**: `HCAPTCHA_SECRET` must be set in production (added to `.env.example`, listed in DEPLOYMENT_SECURITY_CHECKLIST.md) — the endpoint fails closed if it's missing, so this is a deploy-config item, not a code gap. IP extraction trusts `x-forwarded-for` — accurate only if the hosting platform's proxy sets it and isn't spoofable at the edge (true for standard PaaS/CDN deployments; verify for the actual target).

### AUDIT-004 — No production security response headers
- **OWASP Top 10:2025**: A05 Security Misconfiguration
- **ASVS**: V14 (Configuration) — HTTP security headers
- **Severity**: Medium | **Confidence**: High
- **Affected files**: `vite.config.ts`
- **Attack scenario**: No `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or explicit `Cache-Control` were set anywhere. This doesn't create a specific exploit on its own, but removes several layers of defense-in-depth against XSS, clickjacking, MIME-sniffing, and private-response caching.
- **Impact**: Missing defense-in-depth; SSR/authenticated responses had no explicit cache directive (risk of a shared/browser cache serving one user's page to another under some CDN configurations).
- **Remediation**: Added a `buildCsp()` helper and `routeRules` in `vite.config.ts`'s production Nitro plugin config, applying: CSP (built from the app's actual origins — Supabase, hCaptcha, Open-Meteo, Google Fonts), HSTS (production only), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera scoped to `self` for the capture features, mic/payment denied), `frame-ancestors 'none'`, and a global `Cache-Control: no-store` with a carve-out for hashed static assets under `/assets/**` (`public, max-age=31536000, immutable`).
- **Implementation status**: Fixed, verified live (see below).
- **Verification test**: Built (`bun run build`), ran the actual production server (`bun run start`), and confirmed via `curl -i http://localhost:3000/`:
  ```
  Cache-Control: no-store
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://<project-ref>.supabase.co https://api.open-meteo.com https://hcaptcha.com https://*.hcaptcha.com; frame-src https://hcaptcha.com https://*.hcaptcha.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  permissions-policy: camera=(self), microphone=(), geolocation=(self), payment=()
  ```
  Then loaded the homepage and `/login` in a real browser via Playwright and confirmed **zero CSP-violation console errors** (see AUDIT-007 for the one violation this process found and how it was resolved) and that the hCaptcha widget renders correctly under the policy.
- **Residual risk**: `script-src` includes `'unsafe-inline'` — see AUDIT-007. `img-src` allows any `https:` origin rather than an allowlist (see AUDIT-012). Headers apply to production builds served via `bun run start`/the built Nitro server, not to `vite dev` — matches the existing repo convention of only enabling the Nitro plugin on `command === "build"`.

### AUDIT-005 — Static inline script required `dangerouslySetInnerHTML`
- **OWASP Top 10:2025**: A03 Injection (XSS-adjacent hardening)
- **ASVS**: V5 — output encoding / inline script minimization
- **Severity**: Low | **Confidence**: High
- **Affected files**: `src/routes/__root.tsx`, `public/theme-init.js` (new)
- **Attack scenario**: The dark-mode-flash-prevention script was inlined via `<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />`. The content itself was static and not attacker-influenced, so this was not independently exploitable — but it was the only reason a strict CSP couldn't at least attempt `script-src` without `'unsafe-inline'`, and it's the kind of pattern that becomes dangerous the moment someone edits it to include dynamic data.
- **Impact**: None directly; hardening / CSP-enablement blocker.
- **Remediation**: Moved the script to a static file (`public/theme-init.js`) referenced via `<script src="/theme-init.js" />`. No inline script content remains anywhere in the app.
- **Implementation status**: Fixed.
- **Verification test**: `grep -c dangerouslySetInnerHTML src/**/*.tsx` returns zero matches; confirmed via a real page load (Playwright) that the external script still runs (dark-mode class applied correctly) and the console shows no related errors.
- **Residual risk**: `public/theme-init.js` duplicates the `mila-theme` storage-key literal from `src/constants/app.ts`'s `THEME_STORAGE_KEY` (a static asset can't import a TS constant); a comment cross-references it, but a future rename could silently desync them.

### AUDIT-006 — Subscription plan mutations had no audit trail
- **OWASP Top 10:2025**: A09 Security Logging and Monitoring Failures
- **ASVS**: V7 (Logging) — security-relevant event logging
- **Severity**: Medium | **Confidence**: High
- **Affected files**: `src/lib/subscription-plans.functions.ts`, `src/lib/admin.functions.ts`
- **Attack scenario**: `adminHidePost`/`adminResolveSupportMessage` already called `recordStaffAction` to write to `staff_audit_log`; `adminCreateSubscriptionPlan`, `adminUpdateSubscriptionPlan`, `adminSetSubscriptionPlanArchived`, and `adminDeleteSubscriptionPlan` did not, even though the brief explicitly requires audit trails for "plan creation and mutation, plan feature changes, plan retirement." A compromised or malicious admin account's plan changes (price, featured status, retirement) would leave no record of who did what, when.
- **Impact**: Reduced incident-response capability for plan-catalog tampering.
- **Remediation**: Exported `recordStaffAction` from `admin.functions.ts` and call it from create/update/archive-or-restore/delete in `subscription-plans.functions.ts`, recording actor, action (`plan.created`/`plan.updated`/`plan.retired`/`plan.restored`/`plan.deleted`), target plan ID, and safe metadata (slug/title/changed-field-names — never full free-text description bodies).
- **Implementation status**: Fixed. (`adminReorderSubscriptionPlans` — pure display-order changes — was deliberately left unlogged to avoid audit-log noise on drag-and-drop; call this out if that's the wrong call for your compliance needs.)
- **Verification test**: Code inspection (`grep recordStaffAction src/lib/subscription-plans.functions.ts` shows 4 call sites); `bunx tsc --noEmit` confirms the calls type-check against the exported signature. No live-DB integration test was run (see AUDIT-011).
- **Residual risk**: None significant; `staff_audit_log` itself is already append-only (no UPDATE/DELETE grant to any client role, verified in the base migration).

---

## Open / accepted-risk findings

### AUDIT-007 — CSP `script-src` requires `'unsafe-inline'`
- **OWASP Top 10:2025**: A03 Injection
- **ASVS**: V14 — CSP strength
- **Severity**: Low | **Confidence**: High (verified live)
- **Affected files**: `vite.config.ts`
- **Attack scenario / evidence**: After removing the app's own inline script (AUDIT-005), a strict `script-src 'self' https://hcaptcha.com https://*.hcaptcha.com` (no `unsafe-inline`) was tested in a real browser. It broke the app: `[ERROR] Executing inline script violates ... script-src` for two hashes, followed by `Error: Invariant failed` during hydration. These are inline `<script>` tags injected by TanStack Start's default SSR stream handler (`@tanstack/react-start`'s `defaultStreamHandler`) carrying React 19 hydration data — content that differs per request/page, so it cannot be hash-pinned, and this framework version's `nonce` support (a `nonce?: string` field exists on an internal `BaseContext` type in `@tanstack/start-server-core`) isn't wired through the default entry point used by this project (`src/start.ts` has no custom SSR render entry).
- **Impact**: `script-src 'unsafe-inline'` means CSP does not block inline-script injection if an XSS bug is ever introduced elsewhere; it still blocks loading attacker-hosted external scripts (`<script src="https://evil.example">`), and every other directive (`object-src`, `frame-ancestors`, `base-uri`, `form-action`, `connect-src`/`img-src` allowlisting) remains fully enforced.
- **Remediation attempted**: Verified the failure live (browser console), confirmed the internal `nonce` field exists but isn't threaded through this framework version's default entry, and did not attempt undocumented internal plumbing given the risk of silently breaking SSR streaming in a way this pass couldn't fully verify.
- **Implementation status**: Open / accepted for this pass, with a documented upgrade path.
- **Verification test**: Playwright browser load of `/` and `/login` against the production build, confirming zero console errors with `'unsafe-inline'` present (vs. the reproducible hydration crash without it).
- **Residual risk**: Real, but bounded — React's built-in escaping (no `dangerouslySetInnerHTML` renders any user or AI content anywhere in the app, confirmed by grep) is the actual primary XSS control per the brief's own guidance ("do not rely on CSP as the primary XSS fix"); this CSP gap only removes one defense-in-depth layer for script injection specifically. Revisit if/when a custom SSR entry with nonce support is built and verified in a lower environment first.

### AUDIT-008 — Staff MFA (`aal2`) not enforced for high-risk actions
- **OWASP Top 10:2025**: A07 Identification and Authentication Failures
- **ASVS**: V6 (Authentication) — step-up authentication for high-risk transactions
- **Severity**: Medium | **Confidence**: High
- **Affected files**: `src/lib/admin.functions.ts`, `src/integrations/supabase/auth-middleware.ts`
- **Attack scenario**: A compromised admin/moderator credential (password reuse, phishing) is sufficient to change roles, suspend accounts, or manage plans — no step-up MFA challenge is required, even though Supabase Auth supports TOTP MFA and `aal2` session checks.
- **Impact**: Single-factor compromise of a staff account has full staff-scope blast radius.
- **Remediation**: Not implemented this pass — see ROLE_PERMISSION_MATRIX.md "Staff MFA" section for the assessed rollout path and why enforcing it blind, with zero enrolled admins today, would risk locking out the only bootstrap admin account (Rule 15: documented rather than blocking the whole task on this ambiguity).
- **Implementation status**: Open (by design — needs a product decision + enrollment UI before enforcement).
- **Verification test**: N/A (not implemented).
- **Residual risk**: Real until built. Mitigated partially by: `manage_user_role`/`set_user_suspended` requiring the actor to currently hold an active (non-suspended) admin role at execution time (re-checked inside the `SECURITY DEFINER` function, not just at the call site), and full audit logging of every role/suspension change.

### AUDIT-009 — No active session revocation on suspend
- **OWASP Top 10:2025**: A07 Identification and Authentication Failures
- **ASVS**: V3 (Session Management)
- **Severity**: Low | **Confidence**: High
- **Affected files**: `src/lib/admin.functions.ts` (`adminSetSuspended`), `supabase/migrations/20260713075119_moderator_permissions.sql` (`set_user_suspended`)
- **Attack scenario**: When an admin suspends a user, the user's existing Supabase access token remains cryptographically valid until it expires (default: 1 hour) or is refreshed. `requireSupabaseAuth` re-checks `profiles.suspended` from the database on every Mila server-function call, so **Mila's own server functions** reject the suspended user immediately — but a still-valid access token could still be used for any direct Supabase REST call whose RLS policy doesn't itself gate on `suspended` (e.g., reading rows the policy already allows every authenticated user to read).
- **Impact**: Bounded — up to one access-token lifetime of residual access to *already-permitted* reads via direct Supabase API use; no residual access to any Mila server function.
- **Remediation**: Not implemented this pass. Documented option: call `supabaseAdmin.auth.admin.signOut(userId, "global")` inside `adminSetSuspended` (or inside `set_user_suspended` via a `pg_net`/edge-function callback, since Postgres functions can't call the Auth Admin API directly) to force session invalidation immediately.
- **Implementation status**: Open (documented, not blocking — the existing per-request suspension check already covers every Mila-owned code path).
- **Verification test**: N/A (not implemented).
- **Residual risk**: Low; bounded by token TTL and the fact that no table currently grants broad read access that would matter more once suspended (feed posts remain visible to any member regardless of the poster's status, by product design, not a suspension-related gap).

### AUDIT-010 — AI credit deduction is a documented no-op
- **Severity**: Informational | **Confidence**: High
- **Affected files**: `src/lib/credits.server.ts`
- **Status**: Not a security bug — pre-existing, explicitly documented product decision (`IN DEVELOPMENT [credit-enforcement]`) to leave AI features unmetered for this release, separate from the security-relevant AI *rate limiting* fixed in AUDIT-002. Not modified, per Rule 12 (preserve existing intentional behavior) and the brief's explicit instruction not to build billing/entitlement assignment in this pass. Flagging here only so it isn't mistaken for an overlooked finding.

### AUDIT-011 — RLS/pgTAP tests not executable in this environment
- **Severity**: Informational | **Confidence**: High
- **Affected files**: `supabase/tests/rls_authorization.test.sql` (new)
- **Status**: This sandbox has no Docker and no Supabase CLI (`docker info` and `supabase --version` both fail — verified, not assumed). A 23-assertion pgTAP suite was written covering: anonymous/member plan-write denial, member/moderator role-mutation denial, moderator hidden-post visibility (positive) vs. member denial (negative), moderation-reason confidentiality, support-message access scoping, audit-log append-only enforcement (admin and moderator both denied DELETE), `rate_limit_buckets`/`check_rate_limit` inaccessibility to any client role, cross-user profile-update denial, and AI-credit-column write denial. **Not run** — must be executed via `supabase start && supabase test db` before this branch ships. Treat every RLS-related "Fixed" claim in this document as verified by code/policy inspection, not by an executed test, until that suite has actually run green.

### AUDIT-012 — CSP `img-src` allows any `https:` origin
- **Severity**: Informational | **Confidence**: High
- **Affected files**: `vite.config.ts`
- **Status**: Accepted tradeoff. `products.image_url` (dupe-hunter catalog) and admin-entered plan/product imagery are free-text URLs with no host allowlist at the data layer, and AI-analysis flows may reference images from various sources. An `img-src` allowlist tight enough to be meaningful would need to be revisited every time a new product/brand is onboarded. `<img src>` does not execute script under CSP's threat model, so the residual risk is limited to pixel-tracking/referrer-leak style concerns, not code execution — judged acceptable versus the operational cost of a host allowlist here.

---

## Dependency & build audit (Phase 15)

```
bun install --frozen-lockfile   # not run destructively against the working tree during this audit; existing lockfile already in place and used by all commands below
bun audit                       # No vulnerabilities found
bun outdated                    # ~20 packages have newer patch/minor versions (Radix UI, TanStack, supabase-js, etc.) — no CVEs flagged by bun audit; not bumped in this pass per Rule 14 (no unnecessary dependency churn)
bun pm untrusted                # Found 0 untrusted dependencies with scripts
bun run lint                    # Clean (only pre-existing react-refresh/only-export-components warnings, unrelated to this change)
bunx tsc --noEmit                # Clean
bun run build                   # Succeeds
bun test                        # 22 tests pass (4 pre-existing + 18 added this pass)
```

No unexpected lifecycle scripts, no production source-map exposure investigated further
(Vite's default build does not emit source maps unless configured — not configured here),
no dev-only routes found enabled in production config. Nitro `3.0.260603-beta` is a beta
dependency already in place before this audit — flagged as an existing operational
consideration (beta-channel server runtime), not something to blindly upgrade or downgrade
mid-audit.

## CI

Added `.github/workflows/ci.yml`: runs on every push/PR — `bun install --frozen-lockfile`,
`bun run lint`, `bunx tsc --noEmit`, `bun test`, `bun audit`, `bun run build`. No secrets are
referenced in the workflow file.
