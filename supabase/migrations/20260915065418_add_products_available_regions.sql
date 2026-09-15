-- Additive: region-gates product recommendations in the "Shop this look" grid.
-- Empty array = available everywhere (default, and the current state of every
-- seeded product — no authoritative per-brand shipping-region data exists yet
-- to populate this accurately, so it's left universal until real data is supplied).
ALTER TABLE public.products
  ADD COLUMN available_regions TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX idx_products_regions ON public.products USING GIN(available_regions);
