-- Additive shop-metadata fields for the shoppable-post drawer's "Shop" tab
-- (rating, units sold, shipping, discount, verified-seller badge). All
-- nullable — most of the existing catalog has none of this data yet, and
-- post-item-drawer.tsx renders each field conditionally.
--
-- This table uses column-level GRANTs (confirmed live: authenticated has an
-- explicit per-column SELECT grant on products/brands, not a table-level
-- grant) — every new column must be added to the grant in the same
-- migration or it's invisible to the client despite existing in the row.
ALTER TABLE public.products
  ADD COLUMN rating NUMERIC(2, 1) CHECK (rating BETWEEN 0 AND 5),
  ADD COLUMN units_sold INTEGER CHECK (units_sold >= 0),
  ADD COLUMN shipping_info TEXT,
  ADD COLUMN discount_percent SMALLINT CHECK (discount_percent BETWEEN 0 AND 100);

ALTER TABLE public.brands
  ADD COLUMN is_verified_seller BOOLEAN NOT NULL DEFAULT false;

GRANT SELECT (rating, units_sold, shipping_info, discount_percent)
  ON public.products TO authenticated;
GRANT SELECT (is_verified_seller) ON public.brands TO authenticated;

-- rating/units_sold/shipping_info/discount_percent stay NULL until real
-- merchant data is available — no synthetic placeholder values seeded here.
UPDATE public.brands SET is_verified_seller = true WHERE status = 'active';
