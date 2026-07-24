-- ============================================================================
-- credit_packs — dynamic, admin-managed one-time credit top-up catalog.
--
-- Same conventions as subscription_plans (20260713120000):
--   * money as integer smallest-unit (cents for usd)
--   * updated_at via public.update_updated_at_column()
--   * RLS with (select ...) initplan pattern, explicit TO authenticated
--   * writes are service-role only (assertAdmin in credit-packs.functions.ts)
--   * paddle_product_id/paddle_price_id populated directly in the database
--     after creating the matching product/price in Paddle — never set by
--     the admin pack form (see 20260724120000_add_paddle_ids_to_subscription_plans.sql)
--
-- No "featured" or "billing_interval" concept — these are one-time top-ups,
-- not membership tiers. No "Mila Unlimited"-style tier either (dropped during
-- design: doesn't fit a balance that resets daily to a plan allowance).
-- ============================================================================

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

ALTER TABLE public.credit_packs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_credit_packs_active_sort
  ON public.credit_packs (is_active, sort_order);

-- Lookup direction used by the webhook: Paddle price -> local pack.
CREATE UNIQUE INDEX credit_packs_paddle_price_id_idx
  ON public.credit_packs (paddle_price_id)
  WHERE paddle_price_id IS NOT NULL;

CREATE TRIGGER update_credit_packs_updated_at
  BEFORE UPDATE ON public.credit_packs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON public.credit_packs FROM anon, authenticated;
GRANT SELECT ON public.credit_packs TO authenticated;

CREATE POLICY "Authenticated view active credit packs" ON public.credit_packs
  FOR SELECT TO authenticated
  USING (is_active AND archived_at IS NULL);

CREATE POLICY "Admins view all credit packs" ON public.credit_packs
  FOR SELECT TO authenticated
  USING ((select public.has_role(auth.uid(), 'admin')));
