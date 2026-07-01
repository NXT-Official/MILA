-- Drop wardrobe-related schema in the pivot to OOTD curation.
DROP TABLE IF EXISTS public.clothes CASCADE;
ALTER TABLE public.user_entitlements DROP COLUMN IF EXISTS wardrobe_slots;