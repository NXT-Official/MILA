# Deployment Security Checklist

Run through this before every production deploy of a branch that touches auth, RLS,
storage, or the endpoints listed in SECURITY_AUDIT.md.

## Secrets & environment

- [ ] `SUPABASE_SERVICE_ROLE_KEY` set only in the server runtime's secret store — never in a
      `VITE_*` variable, never committed. Confirm with `grep -r "service_role\|SERVICE_ROLE" .output/client` after a build — must return nothing.
- [ ] `HCAPTCHA_SECRET` set server-side (new in this pass — required for the support form and
      recommended in Supabase Auth's Attack Protection captcha settings for signup/login).
- [ ] `AI_API_KEY`, `CLOUDFLARE_API_TOKEN` set server-side only.
- [ ] `.env` is git-ignored (verified) and was never committed; `.env.example` contains only
      placeholders.
- [ ] Rotate any credential that may have been exposed in logs, chat, or a shared terminal
      before this audit — this pass did not find one committed, but rotate proactively if in
      doubt.

## Supabase project configuration

- [ ] Auth → Attack Protection: enable hCaptcha for signup and login, using the same secret
      as `HCAPTCHA_SECRET`. (The app already sends `captchaToken` to `signUp`/`signInWithPassword`;
      Supabase only verifies it if this is turned on.)
- [ ] Confirm publishable/anon key type in use (legacy `anon` vs new `publishable`) matches
      what `SUPABASE_PUBLISHABLE_KEY` expects; if migrating key types, test the JWT-verification
      path in `auth-middleware.ts` (`getClaims`) against the new key format in staging first.
- [ ] Run Supabase's built-in **Security Advisor** (Dashboard → Advisors) after applying
      migrations and address anything it flags beyond what's in SECURITY_AUDIT.md.
- [ ] Apply the new migrations in order:
      `20260714090000_atomic_rate_limits.sql` (and any others in this branch), via
      `supabase db push` or your CI migration step. Back up before applying to production.
- [ ] Consider enrolling MFA for all current admin accounts before any future work that
      enforces `aal2` on staff actions (see ROLE_PERMISSION_MATRIX.md).

## Storage

- [ ] Confirm bucket visibility matches intent: `outfits` public (by design — AI providers
      fetch these URLs), `posts` private (signed URLs only).
- [ ] Confirm no new bucket was added without matching RLS policies for INSERT/SELECT/UPDATE/DELETE
      scoped to `storage.foldername(name)[1] = auth.uid()`.
- [ ] If adding file-size/MIME enforcement changes, verify `outfit-image-storage.server.ts`'s
      `MAX_IMAGE_BYTES` / `ALLOWED_MIME_EXT` still match the bucket's own configured limits
      (Studio → Storage → bucket settings) — the two are independent and both matter.

## Headers & caching

- [ ] After `bun run build && bun run start`, curl the site and confirm
      `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`,
      `Referrer-Policy`, `Permissions-Policy`, and `Cache-Control: no-store` are present
      (see SECURITY_AUDIT.md AUDIT-013 for the verified example).
- [ ] Load the app in a real browser and check the console for CSP violations before
      shipping any CSP change — this pass found (and fixed) one: a strict `script-src`
      without `'unsafe-inline'` breaks TanStack Start's hydration payload.
- [ ] `Strict-Transport-Security` is only sent when `mode === "production"` — confirm the
      production build is actually invoked with `NODE_ENV=production`/`--mode production`
      so it isn't silently skipped.

## Rate limiting & abuse controls

- [ ] Confirm `public.rate_limit_buckets` exists and `check_rate_limit` is callable by
      `service_role` only (`\dp public.rate_limit_buckets`, `\df+ public.check_rate_limit`).
- [ ] Consider a periodic cleanup job (pg_cron) for `rate_limit_buckets` once row count
      becomes operationally relevant — not required for correctness.
- [ ] Tune the per-endpoint limits in `generate-outfit.functions.ts`,
      `analyze-outfit.functions.ts`, `dupe-hunter.functions.ts`,
      `analyzePersonalColor.functions.ts`, `analyze-clothing.functions.ts`, and
      `concierge-chat.functions.ts` against real usage/cost data — the values shipped here
      are conservative defaults, not measured production numbers.

## CI / build gates

- [ ] `.github/workflows/ci.yml` (added in this pass) runs on every PR:
      `bun install --frozen-lockfile`, `bun run lint`, `bunx tsc --noEmit`, `bun test`,
      `bun audit`, `bun run build`. Confirm it's required for merge in branch protection.
- [ ] `bun audit` must be reviewed on every dependency bump, not just at CI green — a clean
      run today doesn't cover advisories published after this audit.

## Post-deploy verification

- [ ] Log in as a fresh member and confirm `/admin/*` routes render the redirect (not the
      staff shell).
- [ ] Log in as a moderator and confirm the members/subscription-plans admin pages are
      inaccessible (redirect), while moderation/support pages work.
- [ ] Confirm a suspended test account is rejected by a server function within the
      access-token's lifetime (or immediately, if suspended after the token was issued).
- [ ] Submit the anonymous support form once above and once below the rate limit; confirm
      the second batch is rejected with a clear message, not a raw 500.
