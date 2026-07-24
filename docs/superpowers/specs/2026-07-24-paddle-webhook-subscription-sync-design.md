# Paddle webhook receiver + subscription sync — design

## Context

`subscription_plans` exists with `paddle_product_id`/`paddle_price_id` populated for the
three live sandbox plans (starter, style-pro, atelier-elite). Nothing customer-facing
exists yet — no checkout, no pricing page, no webhook receiver.

This spec covers **only** the backend sync layer: receiving Paddle webhooks and mirroring
subscription state (and its entitlement effects) into Supabase. Pricing page + checkout is
a separate sub-project, specced and built after this one, because checkout is what will
actually create the subscriptions this layer consumes.

## Scope

In scope:

- `subscriptions` table + `profiles.paddle_customer_id` column
- `POST /api/webhooks/paddle` — signature verification + event handling for
  `subscription.created`, `subscription.updated`, `subscription.canceled`
- Entitlement sync (`user_entitlements.ai_credits`, `.ads_removed`) driven by subscription
  status changes

Out of scope (future sub-projects):

- Checkout, pricing page (`custom_data.user_id` — the identity link this design depends on
  — gets set there)
- Self-serve cancel / plan-change UI
- `transaction.*` / `customer.*` events (not needed: `custom_data.user_id` rides along on
  every subscription event already)
- A webhook events audit/log table (the upsert is idempotent by final state; add one later
  if replay/audit becomes a real need)

## Customer identity

Paddle customers are linked to Supabase users via `custom_data.user_id`, set on the
transaction at checkout (sub-project #2) and propagated by Paddle onto the resulting
subscription object. Every subscription webhook event therefore carries the Supabase
`user_id` directly — no email matching, no race conditions.

`profiles.paddle_customer_id` is set (if not already) the first time we see a customer for
that user, for future reference (e.g. customer portal deep links).

## Schema

```sql
ALTER TABLE public.profiles
  ADD COLUMN paddle_customer_id TEXT UNIQUE;

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  paddle_subscription_id TEXT NOT NULL UNIQUE,
  paddle_customer_id TEXT NOT NULL,
  status TEXT NOT NULL,               -- Paddle's status strings, stored verbatim
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id, updated_at DESC);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON public.subscriptions FROM anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;

CREATE POLICY "Users view their own subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policies: all writes are service-role only, via the
-- webhook handler. Same pattern as subscription_plans.
```

One active subscription per user is assumed (matches the 3-tier plan set). `user_id` is
not unique-constrained on `subscriptions` so history survives plan changes; sync logic
always operates on the newest row for a user (`ORDER BY updated_at DESC LIMIT 1`).

## Webhook handler

`src/routes/api/webhooks/paddle.ts` — a raw TanStack Start API route (not a
`createServerFn`): Paddle POSTs with its own HMAC signature, not a CSRF token or Supabase
session, so this route sits outside both `csrfMiddleware` (which only filters
`handlerType: "serverFn"`) and `requireSupabaseAuth`. It authenticates via the Paddle
signature and writes through `supabaseAdmin`.

**Signature verification** (`node:crypto`, no SDK dependency needed):

1. Read the **raw body** (`await request.text()`) — must happen before any JSON parsing,
   since the signature covers raw bytes.
2. Parse the `Paddle-Signature` header: `ts=<unix_ts>;h1=<hex_hmac>`.
3. Compute ``HMAC-SHA256(PADDLE_WEBHOOK_SECRET, `${ts}:${rawBody}`)`` and compare to `h1`
   with `crypto.timingSafeEqual`.
4. Mismatch → `401`, stop. `PADDLE_WEBHOOK_SECRET` missing at startup → fail fast via the
   existing `requireEnv` helper (`src/lib/env.ts`), same pattern as `client.server.ts`.

**Event handling** — `subscription.created`, `subscription.updated`, `subscription.canceled`:

1. Read `data.custom_data.user_id`. Missing → `console.error`, return `200` (this
   shouldn't happen once checkout sets it correctly; not the webhook's job to fix, and we
   don't want Paddle retry-storming a payload we can never resolve).
2. Look up the plan: `subscription_plans` where `paddle_price_id = data.items[0].price.id`
   (the unique index already exists). Not found → same log-and-`200` treatment.
3. Upsert `subscriptions` on `paddle_subscription_id`: `plan_id`, `status`,
   `current_period_end = data.current_billing_period.ends_at`,
   `cancel_at_period_end = data.scheduled_change?.action === "cancel"`.
4. If `profiles.paddle_customer_id` is unset for this user, set it to `data.customer_id`.
5. Run entitlement sync (below) for this user.

Idempotency: no separate events-log table. The upsert converges on Paddle's latest
reported state regardless of delivery order or retries, so re-delivery is a no-op in
effect.

## Entitlement sync

Effective status: `active` and `trialing` are "in force." `past_due` also counts as in
force — that's the grace period the design intentionally protects (dunning retries
shouldn't cut a paying customer off instantly). `canceled` and `paused` are not in force.

- **Refill trigger** (reset `ai_credits` to `plan.credits_included`): fires when
  `current_period_end` in the incoming payload has moved forward compared to what's
  currently stored (a real renewal), or on the first `subscription.created` while status is
  already active/trialing (initial grant). This distinguishes a genuine renewal from an
  unrelated `subscription.updated` (e.g. a payment-method change mid-cycle).
- **Grant** (entering active/trialing/past_due from something else, or first time seen):
  `user_entitlements.ads_removed = true`. Assumption: any paid tier removes ads, regardless
  of plan — flag if this should vary by plan.
- **Revoke** (status becomes `canceled` or `paused`): `ads_removed = false`. Credits are
  **not** clawed back — `ai_credits` is a consumable balance already (decremented
  elsewhere by usage), so revocation just stops future refills rather than deleting what's
  left.

## Testing

- `src/routes/api/webhooks/paddle.test.ts` (`bun:test`, matching the existing
  `*.functions.test.ts` co-location pattern): unit-tests signature verification
  (valid/invalid/tampered) and the event → upsert/entitlement mapping against a mocked
  Supabase client. No network calls.
- Manual acceptance check during implementation: fire real `subscription.created` /
  `.updated` / `.canceled` events at a local tunnel via the Paddle sandbox webhook
  simulator (`paddle:sandbox-testing`) and confirm `subscriptions` and `user_entitlements`
  land correctly.
