-- Additive: link-freshness verification metadata for the products catalog.
-- Populated by an admin-run link-verification pass (scripts/verify-product-links.ts),
-- not by users or by AI — matchLookProducts filters on these before scoring.
ALTER TABLE public.products
  ADD COLUMN last_verified_at TIMESTAMPTZ,
  ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('verified','unverified','broken')),
  ADD COLUMN in_stock BOOLEAN NOT NULL DEFAULT true;
