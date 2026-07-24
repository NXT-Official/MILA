# Daily credit reset + usage meter — design

## Context

The membership drawer (built in the Paddle billing sub-projects) currently shows plan
name, a static credit count, and an "Acquire Passes / IN DEVELOPMENT" block for a
separate, unrelated one-time-pass feature that was never built. The user wants the
pricing cards simplified to a uniform feature list across tiers (differing only by price
and credit amount), credits to reset daily rather than once per billing period, and that
"IN DEVELOPMENT" block replaced with a real usage meter.

Investigating surfaced a bigger fact: **credit consumption doesn't exist anywhere in the
codebase yet.** `consumeAiCredit` (`src/lib/credits.server.ts`) is a stub that always
returns `999` and never touches the database; `FEATURES.creditEnforcement` is explicitly
flagged `"development"` / "not yet enforced." `isInsufficientCreditsError`
(`src/lib/credits.ts`) is also a stub that always returns `false`, though the three UI
call sites that would react to it (`app-shell.tsx`, `dashboard.tsx`,
`studio-camera-drawer.tsx`, all opening `UpgradeSlotsDialog`) are already wired and ready.
There is no cron/scheduled-job infrastructure in the project at all. This spec therefore
covers turning on real credit enforcement with a daily-reset allowance, not a cosmetic
UI change.

## Scope

In scope:
- Plan data: uniform feature bullets across the 3 tiers, Atelier Elite's
  `credits_included` changed from 1500 (framed as "per year") to 150 (a daily allowance)
- `user_entitlements.credits_reset_at` column + an atomic `consume_ai_credit` Postgres
  function
- Real `consumeAiCredit` / `isInsufficientCreditsError` implementations
- `FEATURES.creditEnforcement` flipped to `"available"`
- Membership drawer usage meter (replacing the dev-flagged passes block)
- `UpgradeSlotsDialog` gets a working "View Membership Plans" link to `/pricing`

Out of scope:
- One-time credit packs (`UpgradeSlotsDialog`'s existing disabled section) — separate,
  still-unbuilt feature, untouched here
- Timezone-aware reset (boundary is UTC midnight for everyone — see below)
- Any change to the subscription/checkout/cancel flows built in the prior sub-projects

## Decisions

- **Enforcement, not just tracking.** Once a user hits 0 credits, generation is blocked
  and the existing paywall dialog opens — the paywall UI was already built for exactly
  this and has never fired because nothing threw the error it listens for.
- **Reset mechanism: lazy, on read/consume — no cron.** The project has no scheduled-job
  infrastructure. `consume_ai_credit` checks whether `credits_reset_at` is today every
  time it's called; if not, it resets first, then proceeds. Self-healing (a user away for
  three days just gets one reset to today's allowance on their next action) and requires
  no new infrastructure.
- **Reset boundary: UTC midnight.** No user timezone data is collected anywhere in this
  app today; UTC is the only boundary that doesn't require adding one.
- **Elite's daily allowance: 150.** Keeps a similar step-up ratio to Starter→Pro
  (25→100→150) rather than the disproportionate 1500/day a literal reading of the old
  "1500 per year" copy would imply under daily reset.
- **Free tier (no subscription) also resets daily**, to the existing default of 5 — one
  uniform rule for everyone rather than a special case for non-subscribers.

## Data model

```sql
ALTER TABLE public.user_entitlements
  ADD COLUMN credits_reset_at DATE;
```

`consume_ai_credit(_user_id UUID, _daily_allowance INTEGER) RETURNS TABLE(allowed BOOLEAN,
remaining INTEGER)` — mirrors the existing `check_rate_limit` function's conventions
exactly (`SECURITY DEFINER`, `SET search_path = pg_catalog, public`, `service_role`-only
execute grant, no client access whatsoever):

1. `SELECT ai_credits, credits_reset_at FROM user_entitlements WHERE user_id = _user_id
   FOR UPDATE` — locks the row. This lock is what makes concurrent calls for the same
   user safe (two requests racing can't both observe pre-reset credits), the same way
   `check_rate_limit`'s single-statement upsert gets atomicity from Postgres serializing
   conflicting writes on one key.
2. Compute the post-reset credit count: `_daily_allowance` if `credits_reset_at IS
   DISTINCT FROM CURRENT_DATE`, else the existing `ai_credits` value.
3. If that's `<= 0`: persist `ai_credits = 0, credits_reset_at = CURRENT_DATE`, return
   `(false, 0)`.
4. Otherwise: persist `ai_credits = post_reset - 1, credits_reset_at = CURRENT_DATE`,
   return `(true, remaining)`.

## Enforcement wiring

- `src/lib/credits.server.ts`: `consumeAiCredit(supabase, userId)` first resolves the
  caller's daily allowance — the same two-query pattern already proven in
  `mySubscriptionQueryOptions` (find the in-force subscription via `supabase`, the
  RLS-scoped client already passed in; look up its plan's `credits_included`; fall back to
  the shared `DEFAULT_AI_CREDITS` constant if there's no in-force subscription). It then
  calls the new RPC via `supabaseAdmin` (service role) — `user_entitlements` has no
  authenticated-write policy by design ("credits and ads_removed are money"), so this must
  go through the service role, exactly like `consumeRateLimit` already does for its own
  RPC call. Throws `InsufficientCreditsError` when `allowed` is `false`; otherwise returns
  `remaining`.
- `src/lib/credits.ts`: adds `InsufficientCreditsError` (a plain `Error` subclass, `.name`
  set to the existing `INSUFFICIENT_CREDITS` constant — this file is imported client-side
  too, so it must stay free of server-only imports). `isInsufficientCreditsError` becomes a
  real `instanceof` check. `DEFAULT_AI_CREDITS` moves here (was previously declared, unused
  for real logic, inside `credits.server.ts`) so both the server-side resolver and the
  drawer's free-tier UI math share one source of truth.
- All 3 existing `consumeAiCredit` call sites (`generate-outfit.functions.ts`,
  `dupe-hunter.functions.ts`, `concierge-chat.functions.ts`) and all 3 existing
  `isInsufficientCreditsError` UI call sites are unchanged — enforcement simply starts
  happening; the integration points were already correctly built.
- `FEATURES.creditEnforcement.status`: `"development"` → `"available"`.

## Usage meter UI

- `mySubscriptionQueryOptions` (`src/lib/queries/subscriptions.ts`) gains one field on
  `MySubscription`: `credits_included`. Already selected as part of the existing plan
  lookup query — no new query needed, just returning a field that's already fetched.
- Membership drawer (`studio-membership-drawer.tsx`): the "Acquire Passes / View Partner
  Editorial / IN DEVELOPMENT" block is replaced with a usage meter: plan name, a progress
  bar, "`{remaining}` of `{total}` credits left today," "Resets in `{Xh Ym}`" — a
  client-side countdown to the next UTC midnight, computed from `Date.now()` (no new data
  needed). "Total" is `subscription.credits_included` when subscribed, else the shared
  `DEFAULT_AI_CREDITS` constant.
- `UpgradeSlotsDialog`: adds a "View Membership Plans" link to `/pricing` above the
  existing (untouched, still-disabled) one-time-pack section.

## Testing

- Unit tests (`bun:test`, same DI pattern as the rest of this codebase — mocked
  `supabase`): the daily-allowance resolver (has an in-force subscription → uses its
  `credits_included`; no subscription → falls back to `DEFAULT_AI_CREDITS`), and
  `isInsufficientCreditsError` / `InsufficientCreditsError`.
- `consume_ai_credit` itself isn't unit-testable in `bun:test` (it's a Postgres function) —
  verified manually against the real database: reset behavior across a simulated day
  boundary by directly manipulating `credits_reset_at`, and confirming the row-lock
  reasoning by inspection (this is the same level of trust this codebase already places in
  `check_rate_limit`, which has no automated concurrency test either).
- Manual verification: consume credits via real outfit generation, confirm the drawer's
  meter updates, confirm hitting 0 opens the paywall dialog with a working "View
  Membership Plans" link, confirm a forced day-boundary reset (via direct DB
  manipulation of `credits_reset_at`, not waiting a real day) restores the plan's daily
  allowance.
