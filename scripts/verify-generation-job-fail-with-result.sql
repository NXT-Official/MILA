-- Behavioural check for
-- supabase/migrations/20261008100000_generation_job_fail_with_result.sql
--
-- Run against a LOCAL Supabase database that has every migration applied, as
-- the `postgres` role:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify-generation-job-fail-with-result.sql
-- (or `supabase db reset` first, then the same psql line against the local
-- database URL that `supabase status` prints).
--
-- Everything runs in one transaction that ends in ROLLBACK: the test members
-- and their jobs never persist. Any failed expectation raises "FAIL: ..." and
-- psql stops with a non-zero exit code; a clean run ends with
-- "fail_generation_job_with_result: all checks passed".
--
-- Same pattern as scripts/verify-generation-jobs.sql, which covers
-- fail_generation_job itself; this script checks only what the new function
-- adds: the result it keeps, and that its refund is still exactly once.

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

CREATE FUNCTION pg_temp.daily(p_user UUID) RETURNS INTEGER
LANGUAGE sql AS $$ SELECT ai_credits FROM public.user_entitlements WHERE user_id = p_user $$;

CREATE FUNCTION pg_temp.purchased(p_user UUID) RETURNS INTEGER
LANGUAGE sql AS $$ SELECT purchased_credits FROM public.user_entitlements WHERE user_id = p_user $$;

CREATE FUNCTION pg_temp.set_balance(p_user UUID, p_daily INTEGER, p_purchased INTEGER, p_day DATE)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE public.user_entitlements
     SET ai_credits = p_daily, purchased_credits = p_purchased, credits_reset_at = p_day
   WHERE user_id = p_user
$$;

-- Made-up members. The on_auth_user_created trigger gives each a profile and
-- an entitlements row. A owns the jobs; B only reads.
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000f1',
   'authenticated', 'authenticated', 'member-fwr-a@example.test',
   '{"username":"verify_fwr_a"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000f2',
   'authenticated', 'authenticated', 'member-fwr-b@example.test',
   '{"username":"verify_fwr_b"}'::jsonb, now(), now());

-- ---------------------------------------------------------------------------
-- F1-F5: the result is kept once, the refund lands once
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-0000000000f1';
  hunt CONSTANT JSONB := '{"identifiedAs":"Linen shirt","dupes":[],"creditRefunded":true}';
  j UUID;
  r RECORD;
BEGIN
  -- F1 daily: a running charged job becomes failed with its result, and the
  -- credit goes back to today's pool once.
  PERFORM pg_temp.set_balance(a, 2, 0, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'dupe_search', gen_random_uuid(), '{}', TRUE, 2, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(a) = 1, 'F1 charged one daily credit');
  SELECT s.outcome, s.job INTO r
    FROM public.fail_generation_job_with_result(j, 'no_close_match', TRUE, hunt) AS s;
  PERFORM pg_temp.expect(
    r.outcome = 'failed' AND (r.job).status = 'failed'
    AND (r.job).error_code = 'no_close_match' AND (r.job).result = hunt
    AND (r.job).credit_state = 'refunded' AND (r.job).completed_at IS NOT NULL,
    'F1 failed with its result kept, refunded');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 2 AND pg_temp.purchased(a) = 0,
    'F1 today''s daily pool +1, never purchased');

  -- F2 a second call answers not_running, keeps the first result, refunds nothing.
  SELECT s.outcome, s.job INTO r
    FROM public.fail_generation_job_with_result(j, 'other_code', TRUE, '{"identifiedAs":"Other"}') AS s;
  PERFORM pg_temp.expect(
    r.outcome = 'not_running' AND (r.job).result = hunt AND (r.job).error_code = 'no_close_match',
    'F2 a second call leaves the result and code unchanged');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 2, 'F2 a second call refunds nothing');
  PERFORM public.fail_generation_job(j, 'other_code', TRUE);
  PERFORM pg_temp.expect(pg_temp.daily(a) = 2, 'F2 nor does a plain fail_generation_job after it');

  -- F1 purchased: the credit goes back to purchased once.
  PERFORM pg_temp.set_balance(a, 0, 1, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'dupe_search', gen_random_uuid(), '{}', TRUE, 0, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.purchased(a) = 0 AND
    (SELECT charged_from FROM public.generation_jobs WHERE id = j) = 'purchased',
    'F1b charged one purchased credit');
  PERFORM public.fail_generation_job_with_result(j, 'no_close_match', TRUE, hunt);
  PERFORM public.fail_generation_job_with_result(j, 'no_close_match', TRUE, hunt);
  PERFORM pg_temp.expect(pg_temp.purchased(a) = 1 AND pg_temp.daily(a) = 0,
    'F1b purchased +1, exactly once over two calls');

  -- F3 a succeeded row is returned untouched.
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'dupe_search', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM public.complete_generation_job(j, '{"dupes":["a"]}', NULL);
  SELECT s.outcome, s.job INTO r
    FROM public.fail_generation_job_with_result(j, 'no_close_match', TRUE, hunt) AS s;
  PERFORM pg_temp.expect(
    r.outcome = 'not_running' AND (r.job).status = 'succeeded'
    AND (r.job).result = '{"dupes":["a"]}'::jsonb AND (r.job).error_code IS NULL
    AND (r.job).credit_state = 'charged',
    'F3 a succeeded row is returned untouched');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0, 'F3 a succeeded job is never refunded');

  -- F4 a reaped row is not refunded twice, and gets no result.
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'dupe_search', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  UPDATE public.generation_jobs SET deadline_at = now() - interval '5 minutes' WHERE id = j;
  PERFORM pg_temp.expect(public.reap_generation_jobs(a) = 1, 'F4 the overdue job is reaped');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 1, 'F4 the reaper refunded it once');
  SELECT s.outcome, s.job INTO r
    FROM public.fail_generation_job_with_result(j, 'no_close_match', TRUE, hunt) AS s;
  PERFORM pg_temp.expect(
    r.outcome = 'not_running' AND (r.job).error_code = 'deadline_exceeded' AND (r.job).result IS NULL,
    'F4 a reaped row keeps its own failure and no result');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 1, 'F4 a reaped row is not refunded twice');

  -- F5 a free job: failed with its result, nothing to refund.
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'dupe_search', gen_random_uuid(), '{}', FALSE, 1, 300) AS s;
  SELECT s.outcome, s.job INTO r
    FROM public.fail_generation_job_with_result(j, '   ', TRUE, NULL) AS s;
  PERFORM pg_temp.expect(
    r.outcome = 'failed' AND (r.job).result IS NULL AND (r.job).error_code = 'unknown'
    AND (r.job).credit_state = 'none',
    'F5 a null result keeps nothing; a blank code becomes unknown; a free job stays uncharged');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 1, 'F5 nothing refunded for a free job');
END;
$$;

-- ---------------------------------------------------------------------------
-- F6: a result over 64 KB, an array or a scalar raises invalid_result and
-- changes nothing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-0000000000f1';
  j UUID;
  bad RECORD;
BEGIN
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'dupe_search', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  FOR bad IN
    SELECT * FROM (VALUES
      ('a 70 KB object', jsonb_build_object('note', repeat('x', 70000))),
      ('a JSON array', '["Linen shirt"]'::jsonb),
      ('a JSON string', '"Linen shirt"'::jsonb)
    ) AS t(label, value)
  LOOP
    BEGIN
      PERFORM public.fail_generation_job_with_result(j, 'no_close_match', TRUE, bad.value);
      -- Caught just below, where SQLERRM is not invalid_result: FAIL.
      RAISE EXCEPTION 'expected invalid_result';
    EXCEPTION WHEN raise_exception THEN
      PERFORM pg_temp.expect(SQLERRM = 'invalid_result',
        format('F6 %s raises invalid_result', bad.label));
    END;
  END LOOP;
  PERFORM pg_temp.expect(
    (SELECT status = 'running' AND credit_state = 'charged' AND result IS NULL
       FROM public.generation_jobs WHERE id = j),
    'F6 the job is still running and charged, with no result');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0, 'F6 nothing was refunded');
  -- Leave it failed (refunded) with a result A reads back below.
  PERFORM public.fail_generation_job_with_result(j, 'no_close_match', TRUE,
    '{"identifiedAs":"Kept for A"}');
END;
$$;

-- ---------------------------------------------------------------------------
-- F7: privileges
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn CONSTANT TEXT := 'public.fail_generation_job_with_result(uuid,text,boolean,jsonb)';
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.expect(NOT has_function_privilege(role_name, fn, 'execute'),
      format('F7 %s cannot execute %s', role_name, fn));
  END LOOP;
  PERFORM pg_temp.expect(has_function_privilege('service_role', fn, 'execute'),
    format('F7 service_role can execute %s', fn));
  PERFORM pg_temp.expect(
    (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = fn::regprocedure)
    AND (SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_proc p WHERE p.oid = fn::regprocedure),
    format('F7 %s is SECURITY DEFINER with an empty search_path', fn));
END;
$$;

-- ---------------------------------------------------------------------------
-- F8: RLS. A reads her own failed row's result; B reads nothing of A's and
-- cannot call the function.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f1', TRUE),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', TRUE);

DO $$
BEGIN
  PERFORM pg_temp.expect(
    EXISTS (SELECT 1 FROM public.generation_jobs
             WHERE status = 'failed' AND result = '{"identifiedAs":"Kept for A"}'::jsonb),
    'F8 member A reads her own failed row''s result');
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f2', TRUE),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', TRUE);

DO $$
BEGIN
  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM public.generation_jobs
                 WHERE user_id = '00000000-0000-4000-8000-0000000000f1'),
    'F8 member B reads none of member A''s rows');
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM public.generation_jobs) = 0,
    'F8 member B, who has no jobs, reads nothing');
  BEGIN
    PERFORM public.fail_generation_job_with_result(gen_random_uuid(), 'x', TRUE, '{}');
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'F8 a member cannot call fail_generation_job_with_result');
  END;
END;
$$;

RESET ROLE;

\echo 'fail_generation_job_with_result: all checks passed'

ROLLBACK;
