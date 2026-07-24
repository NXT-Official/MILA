# One-time credit packs — design

## Context

`UpgradeSlotsDialog` ("Studio Energy Depleted") opens whenever a user hits
`InsufficientCreditsError` (see `2026-07-24-daily-credit-reset-design.md`). Today it only
links to `/pricing` to upgrade the subscription plan. An earlier attempt at one-time
credit packs was built as a disabled UI stub (`CREDIT_PACKS` constant, buttons
`disabled` with a "not available yet" notice) and was removed entirely a few commits ago
(`f809835`, `ecdddda`) — it never had a working purchase path or backend.

The user wants this rebuilt for real: when a subscriber runs out of today's daily AI
credits, they can self-serve buy more right there, so they can keep using Mila the same
day instead of waiting for tomorrow's reset or upgrading their plan.

## Scope

In scope:
- Admin-managed `credit_packs` catalog (mirrors `subscription_plans`'s pattern: DB table,
  admin CRUD UI, public read of active packs) — two packs to start: "Mila Daily Pack"
  (+10 credits) and "Mila Studio Pack" (+50 credits), same names/prices as the old removed
  stub ($1.99 / $5.99), but admin-editable rather than hardcoded.
- One-time Paddle checkout for a pack, triggered from `UpgradeSlotsDialog`.
- Webhook handling of Paddle's `transaction.completed` event to grant credits, with
  idempotency against retries.
- `grant_ai_credits` Postgres RPC that adds credits on top of the user's current balance.

Out of scope:
- "Mila Unlimited" tier from the old stub — dropped. Doesn't fit the daily-reset credit
  model cleanly (what does "unlimited" mean against a balance that resets to a plan
  allowance every day?) and the user confirmed it isn't needed.
- Any change to `consume_ai_credit`, the daily-reset logic, or subscription
  checkout/webhook code paths — additive only.
- Credits rolling over — purchased credits are added to today's balance and are subject
  to the same daily reset as everything else in `ai_credits`. This matches the actual ask
  ("so I can use it today"), not a request for a separate non-expiring wallet.
- Refunds/chargebacks reducing `ai_credits` back down — not handled, same as the existing
  subscription webhook has no downgrade-clawback logic either.

## Decisions

- **Admin-managed table, not a hardcoded constant.** `subscription_plans` already proves
  this pattern in this codebase (DB catalog + admin form + Paddle price ID pasted in
  manually) and the user asked for the same for packs, so pricing/credit amounts can
  change without a deploy.
- **Idempotency via a purchases table, not a webhook dedup cache.** Paddle can retry
  webhook delivery; `credit_pack_purchases.paddle_transaction_id UNIQUE` plus
  `ON CONFLICT DO NOTHING` gives an atomic, storage-backed guard — grant only happens if
  the insert actually took a row, mirroring how `subscriptions` upserts on
  `paddle_subscription_id` already dedupe.
- **Distinguishing pack purchases from subscription transactions by price ID lookup, not
  by a new custom_data flag.** A `transaction.completed` event for a subscription renewal
  simply won't match any row in `credit_packs.paddle_price_id`, so the handler is a no-op
  for it. No new signal needs to be threaded through Paddle's checkout options.
- **`grant_ai_credits` duplicates `consume_ai_credit`'s day-reset check rather than
  assuming `ai_credits` is already current.** A user could buy a pack before their first
  API call of the day (stale `credits_reset_at` from yesterday); granting on top of a
  stale balance would under- or over-count. The RPC takes the same `_daily_allowance` the
  consume path resolves, applies the identical reset-if-new-day logic, then adds the
  purchased amount — same row-lock discipline as `consume_ai_credit` for concurrent-call
  safety.
- **Reusing `usePaddleCheckout` as-is.** It's already typed as
  `Pick<PublicSubscriptionPlan, "paddle_price_id">`, which structurally matches anything
  with a `paddle_price_id` field — a `PublicCreditPack` satisfies it with no code change
  to the hook.

## Data model

```sql
CREATE TABLE public.credit_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 60),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 280),
  price_amount INTEGER NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  credits INTEGER NOT NULL CHECK (credits > 0),
  is_active BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  paddle_product_id TEXT,
  paddle_price_id TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS/grants/trigger: identical shape to subscription_plans (20260713120000) —
-- authenticated SELECT active-only, admin SELECT all, writes service-role only via
-- assertAdmin-gated server fns.

CREATE TABLE public.credit_pack_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  credit_pack_id UUID NOT NULL REFERENCES public.credit_packs(id),
  paddle_transaction_id TEXT NOT NULL UNIQUE,
  credits_granted INTEGER NOT NULL CHECK (credits_granted > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- No client access: service-role only (this is the webhook's idempotency ledger).
```

`grant_ai_credits(_user_id UUID, _daily_allowance INTEGER, _amount INTEGER) RETURNS
INTEGER` (remaining balance) — `SECURITY DEFINER`, `service_role`-only execute, same
`FOR UPDATE` row lock as `consume_ai_credit`:

1. Lock and read `ai_credits`, `credits_reset_at`.
2. `post_reset := _daily_allowance` if `credits_reset_at IS DISTINCT FROM CURRENT_DATE`,
   else the existing `ai_credits`.
3. `UPDATE ... SET ai_credits = post_reset + _amount, credits_reset_at = CURRENT_DATE`,
   return the new value.

## Purchase flow

1. Admin creates a one-time Product + Price for each pack directly in the Paddle
   dashboard (same manual step subscription plans already require), then fills in title,
   description, price, credit amount, and pastes the Paddle price ID into a new admin
   form (`src/components/admin/credit-pack-form-dialog.tsx`) — copy of
   `subscription-plan-form-dialog.tsx` minus the billing-interval/featured fields.
2. `UpgradeSlotsDialog` fetches active packs via a new
   `publicCreditPacksQueryOptions` (copy of `publicSubscriptionPlansQueryOptions`,
   `select` from `credit_packs` instead) and renders a button per pack (replacing the old
   disabled stub list). Clicking calls the existing `usePaddleCheckout(userId).openCheckout`
   with the pack's `paddle_price_id` — same call already used on the pricing page.
3. Paddle webhook (`src/routes/api/webhooks/paddle.ts`): add `"transaction.completed"` to
   `HANDLED_EVENT_TYPES`, route it to a new `applyPaddleCreditPackEvent(db, event)` in
   `paddle-webhook.server.ts`:
   - Read `data.items[0].price.id`, look up `credit_packs` by `paddle_price_id`; if no
     match, return (not a pack purchase — e.g. a subscription renewal).
   - Read `data.custom_data.user_id`; if missing, log and return (same guard the
     subscription handler already has).
   - `INSERT INTO credit_pack_purchases (..., paddle_transaction_id = data.id) ON CONFLICT
     (paddle_transaction_id) DO NOTHING` — if no row was actually inserted (retry), return
     without granting again.
   - Otherwise resolve the user's daily allowance (extract the existing inline logic in
     `credits.server.ts` into an exported `resolveDailyCreditAllowance`, reused here) and
     call `grant_ai_credits` via `supabaseAdmin`.
4. Client-side, `usePaddleCheckout`'s existing `checkout.completed` toast + credits-query
   invalidation fires unchanged — it already generically handles "something credits-
   related just happened."

## Admin UI

New route `src/routes/_authenticated/admin/credit-packs.tsx` + `credit-pack-columns.tsx`
+ `credit-pack-form-dialog.tsx`, structurally identical to the subscription-plans admin
trio (list, create, edit, archive — no "featured" concept, no reorder-by-drag beyond
`sort_order` edits in the form). Server fns in `src/lib/credit-packs.functions.ts` mirror
`subscription-plans.functions.ts`: `adminListCreditPacks`, `adminCreateCreditPack`,
`adminUpdateCreditPack`, `adminSetCreditPackArchived`, `adminDeleteCreditPack` — every
mutation gated by `assertAdmin` and logged via `recordStaffAction`. Nav link added
alongside the existing "Subscription Plans" admin link.

## Testing

- Unit tests (`bun:test`, mocked `supabase`, same DI pattern as `credits.server.ts`'s
  existing tests): `applyPaddleCreditPackEvent` — matches a known price ID and grants once;
  unknown price ID is a no-op; duplicate `paddle_transaction_id` grants only once; missing
  `custom_data.user_id` is a no-op.
- `grant_ai_credits` isn't unit-testable in `bun:test` (Postgres function) — verified
  manually: grant when `credits_reset_at` is today (adds on top), grant when it's stale
  (resets to allowance, then adds), same level of manual DB verification the daily-reset
  spec already used for `consume_ai_credit`.
- Manual end-to-end: deplete credits in sandbox, open the paywall dialog, buy a pack via
  Paddle sandbox checkout, confirm the webhook fires, confirm `ai_credits` increases by
  the right amount, confirm a second delivery of the same webhook event (simulated via
  Paddle's webhook simulator or a replayed payload) does not double-grant.
