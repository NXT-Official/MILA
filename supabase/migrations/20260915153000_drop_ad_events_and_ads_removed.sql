-- Ad rewards were never implemented (no code ever wrote to ad_events, no ad
-- SDK is wired up). Removes the dead table and the entitlement column that
-- only ever mirrored subscription status, not any actual ad-free purchase.
DROP TABLE IF EXISTS public.ad_events;
ALTER TABLE public.user_entitlements DROP COLUMN IF EXISTS ads_removed;
