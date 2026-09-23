-- The public landing page's pricing section (src/components/landing/pricing-section.tsx)
-- queries subscription_plans as an unauthenticated visitor, but anon had zero
-- table-level privileges here (blanket REVOKE ALL ... FROM anon in the base
-- schema, GRANT SELECT only ever went to authenticated). Every anonymous
-- visitor hit a permission-denied error on this query, which the component
-- doesn't handle explicitly, showing an indefinite loading skeleton.
-- Columns are all marketing-safe (title, price, features, public Paddle
-- price ID) — same USING predicate as "Authenticated view active plans".
GRANT SELECT ON public.subscription_plans TO anon;

CREATE POLICY "Public view active plans" ON public.subscription_plans
  FOR SELECT TO anon
  USING (is_active AND archived_at IS NULL);
