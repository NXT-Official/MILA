-- ============================================================================
-- Link subscription_plans to their Paddle catalog counterparts.
--
-- Paddle is a separate catalog (products/prices live in Paddle, not here).
-- These columns are populated after creating the matching product/price in
-- Paddle (sandbox or live) — never set by the admin plan form.
-- ============================================================================

ALTER TABLE public.subscription_plans
  ADD COLUMN paddle_product_id TEXT,
  ADD COLUMN paddle_price_id TEXT;

-- Lookup direction used by checkout/webhook code: Paddle price -> local plan.
CREATE UNIQUE INDEX subscription_plans_paddle_price_id_idx
  ON public.subscription_plans (paddle_price_id)
  WHERE paddle_price_id IS NOT NULL;
