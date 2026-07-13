-- ============================================================================
-- subscription_plans — dynamic, admin-managed membership plan catalog.
--
-- Conventions follow 20260706102649_create_full_schema.sql:
--   * money as integer smallest-unit (see purchases.amount_cents)
--   * updated_at via public.update_updated_at_column()
--   * RLS with (select ...) initplan pattern, explicit TO authenticated
--   * writes are service-role only (assertAdmin in the server functions),
--     like user_roles / user_entitlements — plans are money-adjacent data
--
-- No seed rows on purpose: the product has no hardcoded subscription plans
-- today (CREDIT_PACKS in src/constants/app.ts are one-time credit packs,
-- a separate in-development feature). Plans are created via the admin UI.
-- ============================================================================

CREATE TABLE public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable identifier for application code / future payment-provider mapping.
  -- Never reuse a slug for a materially different product.
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 60),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 280),
  -- Integer in the currency's smallest unit (cents for usd) — never floats.
  price_amount INTEGER NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  billing_interval TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_interval IN ('monthly', 'yearly', 'one_time')),
  credits_included INTEGER NOT NULL DEFAULT 0 CHECK (credits_included >= 0),
  -- Short public bullet points; TEXT[] (like products.body_shapes), not
  -- opaque jsonb, so it stays queryable.
  features TEXT[] NOT NULL DEFAULT '{}',
  -- New plans start hidden; an admin activates them deliberately.
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  -- Soft delete: archived plans are invisible publicly and read-only-ish in
  -- the admin UI, but keep their id/slug for future purchase records.
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Serves the public listing (active plans in display order); the leading
-- is_active column also covers plain is_active filters.
CREATE INDEX idx_subscription_plans_active_sort
  ON public.subscription_plans (is_active, sort_order);

-- At most ONE featured, non-archived plan. The server unsets the previous
-- featured plan before setting a new one; this index is the DB-level
-- safeguard against races/bugs.
CREATE UNIQUE INDEX subscription_plans_single_featured_idx
  ON public.subscription_plans ((true))
  WHERE is_featured AND archived_at IS NULL;

CREATE TRIGGER update_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Grants — the app has no anon data access; authenticated users are
-- read-only. service_role already has ALL via the default privileges set in
-- 20260710113000, and bypasses RLS.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.subscription_plans FROM anon, authenticated;
GRANT SELECT ON public.subscription_plans TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS. No INSERT/UPDATE/DELETE policies on purpose: every mutation goes
-- through the service role after a server-side assertAdmin check
-- (src/lib/subscription-plans.functions.ts).
-- ---------------------------------------------------------------------------
CREATE POLICY "Authenticated view active plans" ON public.subscription_plans
  FOR SELECT TO authenticated
  USING (is_active AND archived_at IS NULL);

CREATE POLICY "Admins view all plans" ON public.subscription_plans
  FOR SELECT TO authenticated
  USING ((select public.has_role(auth.uid(), 'admin')));
