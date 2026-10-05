-- Attire classification for catalogue rows — which formality register a
-- piece reads as. Text array (like seasonal_palettes / body_shapes): a piece
-- can legitimately sit at more than one register.
--
-- Values are app-level (src/constants/attire.ts), deliberately not a DB enum
-- so the classifier and the admin console can evolve the vocabulary without a
-- migration: 'Business Professional', 'Business Casual', 'Smart Casual',
-- 'Casual', 'Athletic', 'Evening', 'Formal'.
--
-- Consumed by the inventory review (src/lib/look-products.functions.ts feeds
-- it into the prompt): the occasion gates the shortlist, so a Business Attire
-- look can no longer shortlist sportswear that shares its category. Also
-- surfaced as an "Attire" filter in the admin console's shop catalogue.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS attire TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_products_attire ON public.products USING GIN(attire);
