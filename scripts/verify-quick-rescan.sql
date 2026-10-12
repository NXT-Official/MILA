-- Behavioural check for supabase/migrations/20261008090000_quick_rescan_hair_colour.sql
--
-- Run against a LOCAL Supabase database that has every migration applied, as
-- the `postgres` role:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify-quick-rescan.sql
-- (or `supabase db reset` first, then the same psql line against the local
-- database URL that `supabase status` prints).
--
-- Everything runs in one transaction that ends in ROLLBACK: the test members,
-- their rate limit windows and the second apply of the migration never
-- persist. Any failed expectation raises "FAIL: ..." and psql stops with a
-- non-zero exit code; a clean run ends with "quick rescan: all checks passed".
--
-- What it checks:
--   Q1 the four new columns exist, have the right types and are nullable;
--   Q2 members may update hair_color and last_check_in_at, and only those;
--   Q3 members get 42501 on founding_body_read_at and free_check_in_on;
--   Q4 the hair_color size guard (1 to 40 characters);
--   Q5 a member writes and reads only her own row;
--   R1 to R4 release_rate_limit: service role only, lowers only the window
--      that was charged, by its cost, floored at 0, and never a newer window;
--   Q6 a second apply of the migration changes nothing.

\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.expect(ok BOOLEAN, what TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', what;
  END IF;
  RAISE NOTICE 'ok: %', what;
END;
$$;

CREATE FUNCTION pg_temp.bucket_count(p_key TEXT) RETURNS INTEGER
LANGUAGE sql AS $$ SELECT count FROM public.rate_limit_buckets WHERE key = p_key $$;

-- Made-up members. The on_auth_user_created trigger gives each a profile and
-- an entitlements row.
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000e1',
   'authenticated', 'authenticated', 'quick-rescan-a@example.test',
   '{"username":"verify_rescan_a"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000e2',
   'authenticated', 'authenticated', 'quick-rescan-b@example.test',
   '{"username":"verify_rescan_b"}'::jsonb, now(), now());

-- ---------------------------------------------------------------------------
-- Q1 columns
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND is_nullable = 'YES' AND (
        (table_name = 'profiles' AND column_name = 'hair_color' AND data_type = 'text')
        OR (table_name = 'profiles' AND column_name = 'last_check_in_at'
            AND data_type = 'timestamp with time zone')
        OR (table_name = 'profiles' AND column_name = 'founding_body_read_at'
            AND data_type = 'timestamp with time zone')
        OR (table_name = 'user_entitlements' AND column_name = 'free_check_in_on'
            AND data_type = 'date'))) = 4,
    'Q1 the four columns exist with their types and are nullable');
  PERFORM pg_temp.expect(
    (SELECT hair_color IS NULL AND last_check_in_at IS NULL AND founding_body_read_at IS NULL
       FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000e1')
    AND (SELECT free_check_in_on IS NULL FROM public.user_entitlements
          WHERE user_id = '00000000-0000-4000-8000-0000000000e1'),
    'Q1 a new member starts with every Wave D field empty (founding body scan and today''s check-in free)');
END;
$$;

-- ---------------------------------------------------------------------------
-- Q2, Q3, R1 privileges in the catalog
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn CONSTANT TEXT := 'public.release_rate_limit(text,timestamp with time zone,integer)';
  role_name TEXT;
BEGIN
  PERFORM pg_temp.expect(
    has_column_privilege('authenticated', 'public.profiles', 'hair_color', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.profiles', 'last_check_in_at', 'UPDATE'),
    'Q2 members may update hair_color and last_check_in_at');
  PERFORM pg_temp.expect(
    NOT has_column_privilege('authenticated', 'public.profiles', 'founding_body_read_at', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.profiles', 'founding_body_read_at', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.user_entitlements', 'free_check_in_on', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.user_entitlements', 'free_check_in_on', 'INSERT'),
    'Q3 members have no write grant on founding_body_read_at or free_check_in_on');
  PERFORM pg_temp.expect(
    NOT has_column_privilege('anon', 'public.profiles', 'hair_color', 'UPDATE')
    AND NOT has_column_privilege('anon', 'public.profiles', 'last_check_in_at', 'UPDATE'),
    'Q2 anonymous callers may not update the new columns');
  PERFORM pg_temp.expect(
    has_column_privilege('authenticated', 'public.profiles', 'hair_color', 'SELECT')
    AND has_column_privilege('authenticated', 'public.user_entitlements', 'free_check_in_on', 'SELECT'),
    'Q2 members may read the new columns (RLS still limits them to their own row)');

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.expect(NOT has_function_privilege(role_name, fn, 'execute'),
      format('R1 %s cannot execute release_rate_limit', role_name));
  END LOOP;
  PERFORM pg_temp.expect(has_function_privilege('service_role', fn, 'execute'),
    'R1 service_role can execute release_rate_limit');
  PERFORM pg_temp.expect(
    (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = fn::regprocedure)
    AND (SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_proc p WHERE p.oid = fn::regprocedure),
    'R1 release_rate_limit is SECURITY DEFINER with an empty search_path');
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM pg_proc WHERE proname = 'release_rate_limit'
        AND pronamespace = 'public'::regnamespace) = 1,
    'R1 exactly one release_rate_limit exists');
END;
$$;

-- ---------------------------------------------------------------------------
-- Q4 the size guard (as the owner, so only the CHECK can refuse)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    UPDATE public.profiles SET hair_color = repeat('x', 41)
     WHERE id = '00000000-0000-4000-8000-0000000000e1';
    RAISE EXCEPTION 'expected check_violation';
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.expect(TRUE, 'Q4 a 41-character hair_color is refused');
  END;
  BEGIN
    UPDATE public.profiles SET hair_color = ''
     WHERE id = '00000000-0000-4000-8000-0000000000e1';
    RAISE EXCEPTION 'expected check_violation';
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.expect(TRUE, 'Q4 an empty hair_color is refused');
  END;
  UPDATE public.profiles SET hair_color = repeat('x', 40)
   WHERE id = '00000000-0000-4000-8000-0000000000e1';
  PERFORM pg_temp.expect(
    (SELECT char_length(hair_color) = 40 FROM public.profiles
      WHERE id = '00000000-0000-4000-8000-0000000000e1'),
    'Q4 a 40-character hair_color is kept');
  UPDATE public.profiles SET hair_color = NULL
   WHERE id = '00000000-0000-4000-8000-0000000000e1';
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM pg_constraint
      WHERE conname = 'profiles_hair_color_length' AND conrelid = 'public.profiles'::regclass) = 1,
    'Q4 the size guard exists once');
END;
$$;

-- ---------------------------------------------------------------------------
-- R2 to R4 release_rate_limit (as the owner; the server calls it as service_role)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  k TEXT := 'verify:quick-rescan:' || gen_random_uuid();
  k2 TEXT := 'verify:quick-rescan:' || gen_random_uuid();
  r1 TIMESTAMPTZ;
  r2 TIMESTAMPTZ;
BEGIN
  SELECT c.reset_at INTO r1 FROM public.check_rate_limit(k, 10, 3600) AS c;
  SELECT c.reset_at INTO r2 FROM public.check_rate_limit(k, 10, 3600) AS c;
  PERFORM pg_temp.expect(r1 = r2 AND pg_temp.bucket_count(k) = 2,
    'R2 two charges in one window: count 2, one reset time');
  PERFORM pg_temp.expect(
    (SELECT expires_at FROM public.rate_limit_buckets WHERE key = k) = r1,
    'R2 the window''s expires_at is exactly the reset_at check_rate_limit returned');

  PERFORM pg_temp.expect(public.release_rate_limit(k, r1) AND pg_temp.bucket_count(k) = 1,
    'R2 a release lowers the charged window once');
  -- The server sends back the text PostgREST returned (microseconds included).
  PERFORM pg_temp.expect(
    public.release_rate_limit(k, (to_json(r1) #>> '{}')::timestamptz) AND pg_temp.bucket_count(k) = 0,
    'R2 the reset time as PostgREST returns it matches the window exactly');
  PERFORM pg_temp.expect(public.release_rate_limit(k, r1) AND pg_temp.bucket_count(k) = 0,
    'R2 a release floors at 0');

  PERFORM public.check_rate_limit(k, 10, 3600, 3);
  PERFORM pg_temp.expect(public.release_rate_limit(k, r1, 2) AND pg_temp.bucket_count(k) = 1,
    'R2 a release takes back its cost');

  PERFORM pg_temp.expect(NOT public.release_rate_limit(k, r1 + interval '1 microsecond')
                         AND pg_temp.bucket_count(k) = 1,
    'R3 a reset time that is not the window''s releases nothing');
  PERFORM pg_temp.expect(NOT public.release_rate_limit('verify:quick-rescan:nobody', r1),
    'R3 an unknown key releases nothing');

  BEGIN
    PERFORM public.release_rate_limit('', r1);
    RAISE EXCEPTION 'expected invalid_rate_limit_params';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_rate_limit_params', 'R3 an empty key is refused');
  END;
  BEGIN
    PERFORM public.release_rate_limit(k, NULL);
    RAISE EXCEPTION 'expected invalid_rate_limit_params';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_rate_limit_params', 'R3 a NULL reset time is refused');
  END;
  BEGIN
    PERFORM public.release_rate_limit(k, r1, 0);
    RAISE EXCEPTION 'expected invalid_rate_limit_params';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_rate_limit_params', 'R3 a zero cost is refused');
  END;

  -- R4: charged in one window, released after it rolled over.
  SELECT c.reset_at INTO r1 FROM public.check_rate_limit(k2, 10, 3600) AS c;
  -- The window runs out: its start moves an hour and a minute into the past.
  UPDATE public.rate_limit_buckets SET window_start = window_start - interval '61 minutes'
   WHERE key = k2;
  SELECT c.reset_at INTO r2 FROM public.check_rate_limit(k2, 10, 3600) AS c;
  PERFORM pg_temp.expect(r2 > r1 AND pg_temp.bucket_count(k2) = 1,
    'R4 the next charge opened a new window');
  PERFORM pg_temp.expect(NOT public.release_rate_limit(k2, r1),
    'R4 a release for the old window releases nothing');
  PERFORM pg_temp.expect(
    pg_temp.bucket_count(k2) = 1
    AND (SELECT expires_at FROM public.rate_limit_buckets WHERE key = k2) = r2,
    'R4 the new window is unchanged');
END;
$$;

-- ---------------------------------------------------------------------------
-- Q2, Q3, Q5, R1 as member A
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000e1', TRUE),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', TRUE);

DO $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE public.profiles
     SET hair_color = 'Auburn', last_check_in_at = '2026-10-08T08:00:00Z'
   WHERE id = '00000000-0000-4000-8000-0000000000e1';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.expect(n = 1, 'Q2 member A updates her own hair_color and last_check_in_at');
  PERFORM pg_temp.expect(
    (SELECT hair_color = 'Auburn' AND last_check_in_at = '2026-10-08T08:00:00Z'::timestamptz
       FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000e1'),
    'Q2 member A reads back what she wrote');

  BEGIN
    UPDATE public.profiles SET founding_body_read_at = now()
     WHERE id = '00000000-0000-4000-8000-0000000000e1';
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'Q3 member A gets 42501 on founding_body_read_at');
  END;
  BEGIN
    UPDATE public.user_entitlements SET free_check_in_on = current_date
     WHERE user_id = '00000000-0000-4000-8000-0000000000e1';
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'Q3 member A gets 42501 on free_check_in_on');
  END;
  PERFORM pg_temp.expect(
    (SELECT free_check_in_on IS NULL FROM public.user_entitlements
      WHERE user_id = '00000000-0000-4000-8000-0000000000e1'),
    'Q3 member A can read her own free_check_in_on');

  BEGIN
    UPDATE public.profiles SET hair_color = repeat('x', 41)
     WHERE id = '00000000-0000-4000-8000-0000000000e1';
    RAISE EXCEPTION 'expected check_violation';
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.expect(TRUE, 'Q4 member A cannot store a 41-character hair_color');
  END;

  UPDATE public.profiles SET hair_color = 'Black'
   WHERE id = '00000000-0000-4000-8000-0000000000e2';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.expect(n = 0, 'Q5 member A cannot change member B''s hair_color');
  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000e2'),
    'Q5 member A cannot read member B''s profile');

  BEGIN
    PERFORM public.release_rate_limit('verify:quick-rescan:member', now());
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'R1 a member cannot call release_rate_limit');
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  PERFORM pg_temp.expect(
    (SELECT hair_color IS NULL FROM public.profiles WHERE id = '00000000-0000-4000-8000-0000000000e2'),
    'Q5 member B''s row is untouched');
END;
$$;

-- ---------------------------------------------------------------------------
-- Q6 a second apply is a no-op
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE quick_rescan_before AS
SELECT (SELECT oid FROM pg_proc WHERE proname = 'release_rate_limit'
           AND pronamespace = 'public'::regnamespace) AS fn_oid,
       (SELECT count(*) FROM pg_constraint
         WHERE conrelid = 'public.profiles'::regclass) AS profile_constraints,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name IN ('profiles', 'user_entitlements')) AS columns,
       (SELECT hair_color FROM public.profiles
         WHERE id = '00000000-0000-4000-8000-0000000000e1') AS hair_color,
       (SELECT last_check_in_at FROM public.profiles
         WHERE id = '00000000-0000-4000-8000-0000000000e1') AS last_check_in_at;

\ir ../supabase/migrations/20261008090000_quick_rescan_hair_colour.sql

DO $$
DECLARE
  fn CONSTANT TEXT := 'public.release_rate_limit(text,timestamp with time zone,integer)';
BEGIN
  PERFORM pg_temp.expect(
    (SELECT b.fn_oid = (SELECT oid FROM pg_proc WHERE proname = 'release_rate_limit'
                          AND pronamespace = 'public'::regnamespace)
            AND b.profile_constraints = (SELECT count(*) FROM pg_constraint
                                          WHERE conrelid = 'public.profiles'::regclass)
            AND b.columns = (SELECT count(*) FROM information_schema.columns
                              WHERE table_schema = 'public'
                                AND table_name IN ('profiles', 'user_entitlements'))
       FROM pg_temp.quick_rescan_before AS b),
    'Q6 a second apply adds no column, constraint or function');
  PERFORM pg_temp.expect(
    (SELECT b.hair_color = p.hair_color AND b.last_check_in_at = p.last_check_in_at
       FROM pg_temp.quick_rescan_before AS b, public.profiles AS p
      WHERE p.id = '00000000-0000-4000-8000-0000000000e1'),
    'Q6 a second apply keeps her data');
  PERFORM pg_temp.expect(
    NOT has_function_privilege('authenticated', fn, 'execute')
    AND NOT has_function_privilege('anon', fn, 'execute')
    AND has_function_privilege('service_role', fn, 'execute')
    AND has_column_privilege('authenticated', 'public.profiles', 'hair_color', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.profiles', 'founding_body_read_at', 'UPDATE'),
    'Q6 a second apply keeps every privilege as it was');
END;
$$;

\echo 'quick rescan: all checks passed'

ROLLBACK;
