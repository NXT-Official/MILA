-- Wave D: Today's check-in, body scan, hair colour. ADDITIVE ONLY, re-runnable.
-- Not applied by agents. Apply after 20261007143000 and 20261007170000.
--
-- What this adds:
--   * profiles.hair_color (member-writable, app-validated against HAIR_COLORS,
--     with a 1 to 40 character size guard), profiles.last_check_in_at
--     (member-writable) and profiles.founding_body_read_at (service role only).
--   * user_entitlements.free_check_in_on (service role only).
--   * release_rate_limit(_key, _reset_at, _cost): hands back an hourly slot in
--     the window that was charged, and only that window. Service role only.
-- No table is created, so no new RLS is owed: the existing profiles and
-- user_entitlements policies apply to the new columns.
--
-- Until it is applied, every Wave D surface hides itself (PGRST202 / PGRST204
-- / PGRST205 / 42P01 / 42703 / 42883 read as "not available yet"), and no main
-- profile read selects a Wave D column.
--
-- Full behavioural check (local Supabase only, rolls itself back):
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify-quick-rescan.sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hair_color TEXT,
  ADD COLUMN IF NOT EXISTS last_check_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS founding_body_read_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'profiles_hair_color_length'
                    AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_hair_color_length
      CHECK (hair_color IS NULL OR char_length(hair_color) BETWEEN 1 AND 40);
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.hair_color IS
  'Her hair colour as last confirmed. A colour read fills a blank; Today''s check-in changes it only when she confirms. App-validated against HAIR_COLORS (a size guard only, so new values never need a DROP). Member-writable.';
COMMENT ON COLUMN public.profiles.last_check_in_at IS
  'When she last confirmed a Today''s check-in. Member-writable.';
COMMENT ON COLUMN public.profiles.founding_body_read_at IS
  'When her once-ever free body scan produced a silhouette (service-role write only). NULL = founding body scan still free.';

GRANT UPDATE (hair_color, last_check_in_at) ON public.profiles TO authenticated;

ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS free_check_in_on DATE;
COMMENT ON COLUMN public.user_entitlements.free_check_in_on IS
  'The UTC day her free daily check-in was claimed (service-role write only). NULL or earlier than today = today''s free check-in is available.';

CREATE OR REPLACE FUNCTION public.release_rate_limit(
  _key TEXT, _reset_at TIMESTAMPTZ, _cost INTEGER DEFAULT 1)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_rows INTEGER;
BEGIN
  IF _key IS NULL OR length(_key) = 0 OR length(_key) > 512
     OR _reset_at IS NULL OR _cost IS NULL OR _cost <= 0 THEN
    RAISE EXCEPTION 'invalid_rate_limit_params';
  END IF;
  UPDATE public.rate_limit_buckets AS rl
     SET count = GREATEST(0, rl.count - _cost)
   WHERE rl.key = _key AND rl.expires_at = _reset_at;   -- only the window that was charged
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;
REVOKE EXECUTE ON FUNCTION public.release_rate_limit(TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_rate_limit(TEXT, TIMESTAMPTZ, INTEGER) TO service_role;
