-- Credit packs (members-only one-time top-ups) are removed from the product.
-- Memberships are the only thing we sell, so the catalog, the purchase ledger,
-- and everything hanging off them (indexes, policies, grants, trigger) go too.
DROP TABLE IF EXISTS public.credit_pack_purchases;
DROP TABLE IF EXISTS public.credit_packs;
