-- Behavioural check for supabase/migrations/20261007143000_generation_jobs.sql
--
-- Run against a LOCAL Supabase database that has every migration applied, as
-- the `postgres` role:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify-generation-jobs.sql
-- (or `supabase db reset` first, then the same psql line against the local
-- database URL that `supabase status` prints).
--
-- Everything runs in one transaction that ends in ROLLBACK: the test members,
-- their jobs and storage rows never persist. Any failed expectation raises
-- "FAIL: ..." and psql stops with a non-zero exit code; a clean run ends with
-- "generation_jobs: all checks passed". Works with or without
-- 20261007170000_tracked_ai_credit_refunds.sql applied (its cross-feature
-- checks run only when it is).
--
-- Midnight is simulated per member by pg_temp.midnight(): her pool loses
-- today's stamp AND everything she was charged moves one day back, which is
-- what a real midnight does relative to her rows. A bystander member, who
-- never acts, is checked after every block: nothing another member does may
-- change her balance or what she is owed.
--
-- Races need two sessions and live in scripts/verify-generation-jobs-races.sh
-- (start vs start, reap vs complete, fail vs reap, fail vs fail).

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

-- Midnight for one member: her pool is no longer today's, and everything she
-- was charged so far moved one day into the past.
CREATE FUNCTION pg_temp.midnight(p_user UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.user_entitlements SET credits_reset_at = credits_reset_at - 1 WHERE user_id = p_user;
  UPDATE public.generation_jobs SET created_at = created_at - interval '1 day' WHERE user_id = p_user;
  IF to_regclass('public.ai_credit_spends') IS NOT NULL THEN
    EXECUTE 'UPDATE public.ai_credit_spends SET credit_day = credit_day - 1 WHERE user_id = $1' USING p_user;
  END IF;
END;
$$;

-- Owed daily refunds of both features.
CREATE FUNCTION pg_temp.owed(p_user UUID) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  n INTEGER;
  t INTEGER := 0;
BEGIN
  SELECT count(*) INTO n FROM public.generation_jobs
   WHERE user_id = p_user AND charged_from = 'daily' AND credit_state = 'refunded' AND refund_applied_at IS NULL;
  IF to_regclass('public.ai_credit_spends') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.ai_credit_spends WHERE user_id = $1 AND bucket = ''daily''
               AND refunded_at IS NOT NULL AND refund_applied_at IS NULL'
      INTO t USING p_user;
  END IF;
  RETURN n + t;
END;
$$;

-- Made-up members. The on_auth_user_created trigger gives each a profile and
-- an entitlements row. e0 is the bystander who never acts.
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated', 'member-a@example.test',
   '{"username":"verify_member_a"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated', 'member-b@example.test',
   '{"username":"verify_member_b"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000000c',
   'authenticated', 'authenticated', 'member-c@example.test',
   '{"username":"verify_member_c"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000e0',
   'authenticated', 'authenticated', 'member-bystander@example.test',
   '{"username":"verify_member_by"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000e4',
   'authenticated', 'authenticated', 'member-probe@example.test',
   '{"username":"verify_member_probe"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000e5',
   'authenticated', 'authenticated', 'member-ls@example.test',
   '{"username":"verify_member_ls"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000e7',
   'authenticated', 'authenticated', 'member-x@example.test',
   '{"username":"verify_member_x"}'::jsonb, now(), now());

-- The bystander: a purchased balance, a pool stamped today, and owed daily
-- refunds (one job, plus one tracked receipt when that table exists).
DO $$
DECLARE
  bystander CONSTANT UUID := '00000000-0000-4000-8000-0000000000e0';
  j UUID;
  rc UUID;
BEGIN
  -- Both charged before midnight and refunded after it, so both stay owed
  -- (a spend of hers in between would settle her own owed refunds).
  PERFORM pg_temp.set_balance(bystander, 2, 0, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(bystander, 'look', gen_random_uuid(), '{}', TRUE, 2, 300) AS s;
  IF to_regclass('public.ai_credit_spends') IS NOT NULL THEN
    EXECUTE 'SELECT s.receipt_id FROM public.spend_ai_credit_tracked($1, 2) AS s' INTO rc USING bystander;
  END IF;
  PERFORM pg_temp.midnight(bystander);
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  IF rc IS NOT NULL THEN
    EXECUTE 'SELECT public.refund_ai_credit_tracked($1)' USING rc;
  END IF;
  PERFORM pg_temp.set_balance(bystander, 1, 2, current_date);   -- the sweep stamps her day
END;
$$;

CREATE TEMP TABLE bystander_before AS
SELECT e.ai_credits, e.purchased_credits, e.credits_reset_at,
       pg_temp.owed('00000000-0000-4000-8000-0000000000e0') AS owed
  FROM public.user_entitlements AS e
 WHERE e.user_id = '00000000-0000-4000-8000-0000000000e0';

CREATE FUNCTION pg_temp.bystander_unchanged(p_after TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.expect(
    (SELECT (e.ai_credits, e.purchased_credits, e.credits_reset_at,
             pg_temp.owed('00000000-0000-4000-8000-0000000000e0'))
            = (b.ai_credits, b.purchased_credits, b.credits_reset_at, b.owed)
       FROM public.user_entitlements AS e, pg_temp.bystander_before AS b
      WHERE e.user_id = '00000000-0000-4000-8000-0000000000e0'),
    'BY bystander untouched after ' || p_after);
END;
$$;

SELECT pg_temp.expect((SELECT owed = 1 + (to_regclass('public.ai_credit_spends') IS NOT NULL)::int AND purchased_credits = 2 FROM pg_temp.bystander_before),
  'BY the bystander starts with owed refunds and a purchased balance');

-- A: one allowance credit left today and one purchased credit. B: nothing.
-- C: a full allowance of 3 today, nothing purchased (refunds across the daily reset).
UPDATE public.user_entitlements
   SET ai_credits = 1, purchased_credits = 1, credits_reset_at = current_date
 WHERE user_id = '00000000-0000-4000-8000-00000000000a';
UPDATE public.user_entitlements
   SET ai_credits = 0, purchased_credits = 0, credits_reset_at = current_date
 WHERE user_id = '00000000-0000-4000-8000-00000000000b';
UPDATE public.user_entitlements
   SET ai_credits = 3, purchased_credits = 0, credits_reset_at = current_date
 WHERE user_id = '00000000-0000-4000-8000-00000000000c';

-- ---------------------------------------------------------------------------
-- start / replay / single flight / charge order
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-00000000000a';
  r RECORD;
  j1 UUID;
BEGIN
  -- First start charges the allowance first.
  SELECT s.outcome, s.job INTO r
    FROM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000001',
                                     '{"occasion":"brunch"}', TRUE, 3, 300) AS s;
  j1 := (r.job).id;
  PERFORM pg_temp.expect(r.outcome = 'started', 'S1 first start is started');
  PERFORM pg_temp.expect((r.job).status = 'running', 'S1 job is running');
  PERFORM pg_temp.expect((r.job).credit_state = 'charged', 'S1 job is charged');
  PERFORM pg_temp.expect((r.job).charged_from = 'daily', 'S1 allowance is spent before purchased');
  PERFORM pg_temp.expect((r.job).input = '{"occasion":"brunch"}'::jsonb, 'S1 input is stored');
  PERFORM pg_temp.expect((r.job).deadline_at = now() + interval '300 seconds', 'S1 deadline is now + p_deadline_seconds');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1, 'S1 balance 0 daily / 1 purchased');

  -- The same request again: same job, no second charge.
  SELECT s.outcome, s.job INTO r
    FROM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000001',
                                     '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'existing' AND (r.job).id = j1, 'S2 same request id returns the same job');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1, 'S2 no second charge');

  -- Another request of the same kind while one runs: attach, no charge.
  SELECT s.outcome, s.job INTO r
    FROM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000002',
                                     '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'in_flight' AND (r.job).id = j1, 'S3 a running look is returned as in_flight');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1, 'S3 no charge for in_flight');
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM public.generation_jobs WHERE user_id = a AND kind = 'look') = 1,
    'S3 no row recorded for the attached request');

  -- A different kind runs alongside, and spends the purchased credit.
  SELECT s.outcome, s.job INTO r
    FROM public.start_generation_job(a, 'style_sheet', '11111111-1111-4111-8111-000000000003',
                                     '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND (r.job).charged_from = 'purchased',
    'S4 purchased credit is spent once the allowance is gone');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 0, 'S4 balance 0 / 0');

  -- Out of credits: the existing error, nothing recorded, nothing spent.
  BEGIN
    PERFORM public.start_generation_job(a, 'photo_preview', '11111111-1111-4111-8111-000000000004',
                                        '{}', TRUE, 3, 300);
    RAISE EXCEPTION 'expected insufficient_credits';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'insufficient_credits', 'S5 out of credits raises insufficient_credits');
  END;
  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM public.generation_jobs
                 WHERE client_request_id = '11111111-1111-4111-8111-000000000004'),
    'S5 no job row survives a refused charge');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 0, 'S5 balance unchanged');

  -- A free job (p_charge false) needs no credit.
  SELECT s.outcome, s.job INTO r
    FROM public.start_generation_job(a, 'photo_preview', '11111111-1111-4111-8111-000000000004',
                                     '{}', FALSE, 0, 120) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND (r.job).credit_state = 'none'
                         AND (r.job).charged_from IS NULL, 'S6 free job is started uncharged');
END;
$$;
SELECT pg_temp.bystander_unchanged('start checks');

-- ---------------------------------------------------------------------------
-- complete / replay / image path guard
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-00000000000a';
  b CONSTANT UUID := '00000000-0000-4000-8000-00000000000b';
  j1 UUID;
  j6 UUID;
  r RECORD;
BEGIN
  SELECT id INTO j1 FROM public.generation_jobs WHERE client_request_id = '11111111-1111-4111-8111-000000000001';
  SELECT id INTO j6 FROM public.generation_jobs WHERE client_request_id = '11111111-1111-4111-8111-000000000004';

  SELECT s.outcome, s.job INTO r
    FROM public.complete_generation_job(j1, '{"pieces":[1]}', a::text || '/' || j1::text || '.jpg') AS s;
  PERFORM pg_temp.expect(r.outcome = 'completed' AND (r.job).status = 'succeeded', 'S7 complete moves running to succeeded');
  PERFORM pg_temp.expect((r.job).completed_at IS NOT NULL
                         AND (r.job).image_path = a::text || '/' || j1::text || '.jpg', 'S7 image path and completed_at stored');

  SELECT s.outcome, s.job INTO r FROM public.complete_generation_job(j1, '{"other":true}', NULL) AS s;
  PERFORM pg_temp.expect(r.outcome = 'not_running' AND (r.job).result = '{"pieces":[1]}'::jsonb,
    'S8 a finished job is never overwritten');

  SELECT s.outcome, s.job INTO r
    FROM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000001', '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'existing' AND (r.job).status = 'succeeded'
                         AND (r.job).result = '{"pieces":[1]}'::jsonb, 'S9 a retry replays the stored result');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 0, 'S9 replay is free');

  BEGIN
    PERFORM public.complete_generation_job(j6, '{}', b::text || '/x.jpg');
    RAISE EXCEPTION 'expected invalid_image_path';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_image_path', 'S10 another member''s folder is refused');
  END;
  BEGIN
    PERFORM public.complete_generation_job(j6, '{}', a::text || '/../' || b::text || '/x.jpg');
    RAISE EXCEPTION 'expected invalid_image_path';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_image_path', 'S10 a dot-dot path is refused');
  END;
  PERFORM pg_temp.expect((SELECT status FROM public.generation_jobs WHERE id = j6) = 'running',
    'S10 a refused complete leaves the job running');
END;
$$;
SELECT pg_temp.bystander_unchanged('complete checks');

-- ---------------------------------------------------------------------------
-- fail / refund exactly once / refund to the right bucket
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-00000000000a';
  j1 UUID;
  j4 UUID;
  j6 UUID;
  j UUID;
  r RECORD;
BEGIN
  SELECT id INTO j1 FROM public.generation_jobs WHERE client_request_id = '11111111-1111-4111-8111-000000000001';
  SELECT id INTO j4 FROM public.generation_jobs WHERE client_request_id = '11111111-1111-4111-8111-000000000003';
  SELECT id INTO j6 FROM public.generation_jobs WHERE client_request_id = '11111111-1111-4111-8111-000000000004';

  SELECT s.outcome, s.job INTO r FROM public.fail_generation_job(j4, 'model_timeout', TRUE) AS s;
  PERFORM pg_temp.expect(r.outcome = 'failed' AND (r.job).status = 'failed'
                         AND (r.job).credit_state = 'refunded' AND (r.job).error_code = 'model_timeout',
    'S11 fail with refund marks failed + refunded');
  PERFORM pg_temp.expect(pg_temp.purchased(a) = 1, 'S11 the purchased credit is back');

  SELECT s.outcome, s.job INTO r FROM public.fail_generation_job(j4, 'again', TRUE) AS s;
  PERFORM pg_temp.expect(r.outcome = 'not_running' AND (r.job).error_code = 'model_timeout', 'S12 second fail changes nothing');
  PERFORM pg_temp.expect(pg_temp.purchased(a) = 1, 'S12 refunded exactly once');

  SELECT s.outcome, s.job INTO r FROM public.fail_generation_job(j1, 'late', TRUE) AS s;
  PERFORM pg_temp.expect(r.outcome = 'not_running' AND (r.job).status = 'succeeded'
                         AND (r.job).credit_state = 'charged', 'S13 a succeeded job is never failed or refunded');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1, 'S13 balance unchanged');

  SELECT s.outcome, s.job INTO r FROM public.fail_generation_job(j6, '   ', TRUE) AS s;
  PERFORM pg_temp.expect(r.outcome = 'failed' AND (r.job).credit_state = 'none'
                         AND (r.job).error_code = 'unknown', 'S14 a free job fails without a refund; blank code becomes unknown');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1, 'S14 balance unchanged');

  -- Fail without refund, then refund later: still exactly once.
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000005', '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.purchased(a) = 0, 'S15 charged from purchased');
  SELECT s.outcome, s.job INTO r FROM public.fail_generation_job(j, 'content_policy', FALSE) AS s;
  PERFORM pg_temp.expect(r.outcome = 'failed' AND (r.job).credit_state = 'charged', 'S15 fail without refund keeps the charge');
  SELECT s.outcome, s.job INTO r FROM public.fail_generation_job(j, 'content_policy', TRUE) AS s;
  PERFORM pg_temp.expect(r.outcome = 'not_running' AND (r.job).credit_state = 'refunded', 'S15 a later refund still applies once');
  SELECT s.outcome, s.job INTO r FROM public.fail_generation_job(j, 'content_policy', TRUE) AS s;
  PERFORM pg_temp.expect(pg_temp.purchased(a) = 1, 'S15 and only once');

  -- Allowance refund on the same day goes back to the allowance.
  UPDATE public.user_entitlements SET ai_credits = 1 WHERE user_id = a;
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000007', '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1, 'S16 charged from the allowance');
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  PERFORM pg_temp.expect(pg_temp.daily(a) = 1 AND pg_temp.purchased(a) = 1, 'S16 allowance credit returned to the allowance');

  -- Midnight rule (fix round 1): a same-day refund goes back in full; a daily
  -- credit whose day rolled over is owed and settled by her next spend,
  -- capped at that day's allowance: pool = min(allowance, current + owed).
  -- Never a purchased credit, never a pool above the allowance.
  -- (a) Rolled over; today's pool already full (the sweep stamped it):
  --     owed, and her next spend's full pool absorbs it.
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1, 'S17a charged from the allowance');
  PERFORM pg_temp.midnight(a);
  PERFORM pg_temp.set_balance(a, 3, 1, current_date);   -- the sweep
  SELECT s.outcome, s.job INTO r FROM public.fail_generation_job(j, 'provider_error', TRUE) AS s;
  PERFORM pg_temp.expect((r.job).credit_state = 'refunded' AND (r.job).charged_from = 'daily'
                         AND (r.job).refund_applied_at IS NULL,
    'S17a refunded and owed: only a spend knows the cap; charged_from still says daily');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 3 AND pg_temp.purchased(a) = 1,
    'S17a nothing added yet, never purchased');
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  PERFORM pg_temp.expect(pg_temp.daily(a) = 3 AND pg_temp.purchased(a) = 1 AND pg_temp.owed(a) = 1,
    'S17a still exactly once');
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(a) = 2 AND pg_temp.purchased(a) = 1 AND pg_temp.owed(a) = 0,
    'S17a a full pool absorbs it: never above the allowance');
  PERFORM public.complete_generation_job(j, '{}', NULL);

  -- (b) Rolled over; today's pool NOT stamped yet: owed, nothing written to
  --     a pool the reset would wipe, and the fresh day's first spend absorbs it.
  PERFORM pg_temp.set_balance(a, 1, 1, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1, 'S17b charged from the allowance');
  PERFORM pg_temp.midnight(a);
  SELECT s.outcome, s.job INTO r FROM public.fail_generation_job(j, 'provider_error', TRUE) AS s;
  PERFORM pg_temp.expect((r.job).credit_state = 'refunded' AND (r.job).refund_applied_at IS NULL,
    'S17b refunded and owed while today''s pool does not exist');
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1,
    'S17b nothing written to a pool the reset would wipe; never purchased');
  PERFORM public.reap_generation_jobs(a);
  PERFORM pg_temp.expect(pg_temp.owed(a) = 1, 'S17b still owed after a reap');
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(a) = 2 AND pg_temp.purchased(a) = 1 AND pg_temp.owed(a) = 0,
    'S17b the first spend of a fresh day absorbs it (3 - 1, nothing above the allowance)');
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  PERFORM pg_temp.expect(pg_temp.daily(a) = 3 AND pg_temp.purchased(a) = 1,
    'S17b a same-day refund still comes back in full');
  PERFORM pg_temp.midnight(a);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(a) = 2 AND pg_temp.purchased(a) = 1,
    'S17b a new day starts from the allowance');
  PERFORM public.complete_generation_job(j, '{}', NULL);

  -- (c) She already used today's pool: a rolled-over refund refills it up to
  --     the allowance and pays before a purchased credit, with no false
  --     insufficient_credits when nothing else is left.
  PERFORM pg_temp.set_balance(a, 1, 1, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.midnight(a);
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  PERFORM pg_temp.set_balance(a, 0, 1, current_date);   -- today's 1 used, 1 purchased
  SELECT s.outcome, s.job INTO r
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND (r.job).charged_from = 'daily'
                         AND pg_temp.purchased(a) = 1 AND pg_temp.owed(a) = 0,
    'S17c an owed refund refills a used pool and pays before purchased');
  PERFORM public.complete_generation_job((r.job).id, '{}', NULL);
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.midnight(a);
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  PERFORM pg_temp.set_balance(a, 0, 0, current_date);
  SELECT s.outcome, s.job INTO r
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND (r.job).charged_from = 'daily' AND pg_temp.daily(a) = 0,
    'S17c no false insufficient_credits: the owed refund pays when nothing else is left');
  PERFORM public.complete_generation_job((r.job).id, '{}', NULL);

  -- (d) Allowance 0 today (plan lapsed): the cap is 0, so a rolled-over
  --     refund is absorbed (by ruling) and the purchased credit pays.
  PERFORM pg_temp.set_balance(a, 1, 2, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.midnight(a);
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  SELECT s.outcome, s.job INTO r
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 0, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND (r.job).charged_from = 'purchased'
                         AND pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1 AND pg_temp.owed(a) = 0,
    'S17d allowance 0: the rolled-over refund is absorbed (pool capped at 0), never purchased');
  PERFORM public.complete_generation_job((r.job).id, '{}', NULL);

  -- (e) A free start never touches the balance, whatever allowance it is
  --     handed, even on an unstamped pool.
  UPDATE public.user_entitlements SET ai_credits = 0, purchased_credits = 1, credits_reset_at = current_date - 1
   WHERE user_id = a;
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000024', '{}', FALSE, 1000000, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1
                         AND (SELECT credits_reset_at FROM public.user_entitlements WHERE user_id = a) = current_date - 1,
    'S17e p_daily_allowance is ignored by a free start');
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  PERFORM pg_temp.expect(pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1, 'S17e a failed free job refunds nothing');

  -- (f) The server's pre-start reap (no allowance) leaves a rolled-over
  --     refund for the spend, even on a stamped pool.
  PERFORM pg_temp.set_balance(a, 1, 1, current_date);
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.midnight(a);
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  PERFORM pg_temp.set_balance(a, 3, 1, current_date);   -- the sweep
  PERFORM public.reap_generation_jobs(a);
  PERFORM public.reap_generation_jobs(a);
  PERFORM pg_temp.expect(pg_temp.daily(a) = 3 AND pg_temp.owed(a) = 1,
    'S17f a reap adds nothing above the allowance; the refund waits for the spend');
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', gen_random_uuid(), '{}', TRUE, 3, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(a) = 2 AND pg_temp.owed(a) = 0,
    'S17f the spend settles it against the full pool');
  PERFORM public.complete_generation_job(j, '{}', NULL);

  -- Back to a known balance for the rest of the script: 0 daily / 1 purchased.
  UPDATE public.user_entitlements SET ai_credits = 0, purchased_credits = 1, credits_reset_at = current_date
   WHERE user_id = a;
END;
$$;
SELECT pg_temp.bystander_unchanged('fail and refund checks');

-- ---------------------------------------------------------------------------
-- reaper
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-00000000000a';
  b CONSTANT UUID := '00000000-0000-4000-8000-00000000000b';
  j9 UUID;
  j10 UUID;
  jb UUID;
  r RECORD;
  n INTEGER;
BEGIN
  SELECT (s.job).id INTO j9
    FROM public.start_generation_job(a, 'check_in', '11111111-1111-4111-8111-000000000009', '{}', TRUE, 3, 60) AS s;
  PERFORM pg_temp.expect(pg_temp.purchased(a) = 0, 'S18 check-in charged from purchased');
  SELECT (s.job).id INTO j10
    FROM public.start_generation_job(a, 'body_scan', '11111111-1111-4111-8111-000000000010', '{}', FALSE, 0, 60) AS s;

  -- now() is fixed inside a transaction, so move the deadlines instead.
  UPDATE public.generation_jobs SET deadline_at = now() - interval '31 seconds' WHERE id = j9;
  UPDATE public.generation_jobs SET deadline_at = now() - interval '10 seconds' WHERE id = j10;

  n := public.reap_generation_jobs(a);
  PERFORM pg_temp.expect(n = 1, 'S18 only the job past deadline + 30 s is reaped');
  SELECT * INTO r FROM public.generation_jobs WHERE id = j9;
  PERFORM pg_temp.expect(r.status = 'failed' AND r.error_code = 'deadline_exceeded'
                         AND r.credit_state = 'refunded' AND r.completed_at IS NOT NULL, 'S18 reaped job is failed and refunded');
  PERFORM pg_temp.expect(pg_temp.purchased(a) = 1, 'S18 reaped credit is back');
  PERFORM pg_temp.expect((SELECT status FROM public.generation_jobs WHERE id = j10) = 'running', 'S18 job inside the grace period still runs');
  PERFORM pg_temp.expect(public.reap_generation_jobs(a) = 0, 'S18 reaping again finds nothing');

  -- start reaps the member's overdue job of the same kind instead of attaching to it.
  UPDATE public.generation_jobs SET deadline_at = now() - interval '45 seconds' WHERE id = j10;
  SELECT s.outcome, s.job INTO r
    FROM public.start_generation_job(a, 'body_scan', '11111111-1111-4111-8111-000000000011', '{}', FALSE, 0, 60) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND (r.job).id <> j10, 'S19 an overdue job does not block a new start');
  PERFORM pg_temp.expect((SELECT status FROM public.generation_jobs WHERE id = j10) = 'failed', 'S19 the overdue job was reaped');

  -- The cron form reaps every member.
  UPDATE public.user_entitlements SET purchased_credits = 1 WHERE user_id = b;
  SELECT (s.job).id INTO jb
    FROM public.start_generation_job(b, 'look', '22222222-2222-4222-8222-000000000001', '{}', TRUE, 0, 60) AS s;
  PERFORM pg_temp.expect(pg_temp.purchased(b) = 0, 'S20 member B charged');
  UPDATE public.generation_jobs SET deadline_at = now() - interval '31 seconds' WHERE id = jb;
  n := public.reap_generation_jobs();
  PERFORM pg_temp.expect(n >= 1 AND (SELECT credit_state FROM public.generation_jobs WHERE id = jb) = 'refunded',
    'S20 reap_generation_jobs() reaps other members');
  PERFORM pg_temp.expect(pg_temp.purchased(b) = 1, 'S20 member B refunded');

  -- The reaper follows the midnight rule too: a daily credit reaped after
  -- midnight is owed (never purchased) and her next spend settles it,
  -- capped at the day's allowance.
  UPDATE public.user_entitlements SET ai_credits = 1, credits_reset_at = current_date WHERE user_id = b;
  SELECT (s.job).id INTO jb
    FROM public.start_generation_job(b, 'check_in', '22222222-2222-4222-8222-000000000002', '{}', TRUE, 1, 60) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(b) = 0 AND pg_temp.purchased(b) = 1, 'S20b member B charged from the allowance');
  PERFORM pg_temp.midnight(b);
  UPDATE public.generation_jobs SET deadline_at = now() - interval '31 seconds' WHERE id = jb;
  UPDATE public.user_entitlements SET ai_credits = 1, credits_reset_at = current_date WHERE user_id = b;  -- the sweep
  PERFORM pg_temp.expect(public.reap_generation_jobs(b) = 1, 'S20b overnight job reaped');
  PERFORM pg_temp.expect(pg_temp.daily(b) = 1 AND pg_temp.purchased(b) = 1 AND pg_temp.owed(b) = 1,
    'S20b reaped overnight daily credit is owed, nothing above the allowance, not purchased');

  -- Her next spend settles it against her full pool (1 - 1, absorbed). Then
  -- one reaped while today's pool is unstamped (cron at midnight): owed, not
  -- purchased, not written into a pool the reset would wipe.
  SELECT (s.job).id INTO jb
    FROM public.start_generation_job(b, 'check_in', '22222222-2222-4222-8222-000000000003', '{}', TRUE, 1, 60) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(b) = 0 AND pg_temp.purchased(b) = 1 AND pg_temp.owed(b) = 0,
    'S20c member B charged from the allowance; the owed refund was absorbed by her full pool');
  UPDATE public.generation_jobs SET deadline_at = now() - interval '31 seconds' WHERE id = jb;
  UPDATE public.user_entitlements SET credits_reset_at = current_date - 1 WHERE user_id = b;
  PERFORM public.reap_generation_jobs();
  PERFORM pg_temp.expect((SELECT credit_state = 'refunded' AND refund_applied_at IS NULL
                            FROM public.generation_jobs WHERE id = jb)
                         AND pg_temp.daily(b) = 0 AND pg_temp.purchased(b) = 1,
    'S20c cron-reaped daily credit on an unstamped pool is owed, never purchased');
  UPDATE public.user_entitlements SET ai_credits = 0, purchased_credits = 1, credits_reset_at = current_date
   WHERE user_id = b;
END;
$$;
SELECT pg_temp.bystander_unchanged('reaper checks');

-- ---------------------------------------------------------------------------
-- credit inflation (security review, Revision 2)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c CONSTANT UUID := '00000000-0000-4000-8000-00000000000c';
  allowance CONSTANT INTEGER := 3;
  j1 UUID;
  j2 UUID;
  j3 UUID;
  jx UUID;
  r RECORD;
BEGIN
  -- I1 repeated refunds across the daily reset. Member C has allowance 3 and
  -- no purchased credits. All 3 go on jobs that fail (or are reaped) after
  -- midnight, before the sweep stamps the day.
  SELECT (s.job).id INTO j1 FROM public.start_generation_job(c, 'look', gen_random_uuid(), '{}', TRUE, allowance, 300) AS s;
  SELECT (s.job).id INTO j2 FROM public.start_generation_job(c, 'style_sheet', gen_random_uuid(), '{}', TRUE, allowance, 300) AS s;
  SELECT (s.job).id INTO j3 FROM public.start_generation_job(c, 'check_in', gen_random_uuid(), '{}', TRUE, allowance, 60) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(c) = 0 AND pg_temp.purchased(c) = 0, 'I1 three daily credits in flight at midnight');

  PERFORM pg_temp.midnight(c);
  PERFORM public.fail_generation_job(j1, 'provider_error', TRUE);
  PERFORM public.fail_generation_job(j2, 'provider_error', TRUE);
  UPDATE public.generation_jobs SET deadline_at = now() - interval '31 seconds' WHERE id = j3;
  PERFORM public.reap_generation_jobs(c);
  PERFORM pg_temp.expect(pg_temp.purchased(c) = 0, 'I1 zero purchased credits gained');

  -- Next day: her first request stamps the day; its fresh full pool absorbs
  -- the three. The pool is never above the allowance.
  SELECT (s.job).id INTO jx FROM public.start_generation_job(c, 'body_scan', gen_random_uuid(), '{}', TRUE, allowance, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(c) = allowance - 1 AND pg_temp.purchased(c) = 0 AND pg_temp.owed(c) = 0,
    'I1 next day: never above the allowance (absorbed), zero purchased');
  PERFORM public.reap_generation_jobs(c);
  PERFORM public.fail_generation_job(j1, 'provider_error', TRUE);
  PERFORM pg_temp.expect(pg_temp.daily(c) = allowance - 1 AND pg_temp.purchased(c) = 0,
    'I1 repeated reaps and fails settle nothing twice');
  PERFORM public.complete_generation_job(jx, '{}', NULL);

  -- The day after starts from the allowance.
  PERFORM pg_temp.midnight(c);
  SELECT (s.job).id INTO jx FROM public.start_generation_job(c, 'color_read', gen_random_uuid(), '{}', TRUE, allowance, 300) AS s;
  PERFORM pg_temp.expect(pg_temp.daily(c) = allowance - 1 AND pg_temp.purchased(c) = 0,
    'I1 the following day starts from the allowance');
  PERFORM public.complete_generation_job(jx, '{}', NULL);

  -- I2 a completed job is never refunded (by fail, or by a late reaper).
  UPDATE public.user_entitlements SET ai_credits = 0, purchased_credits = 1, credits_reset_at = current_date WHERE user_id = c;
  SELECT (s.job).id INTO jx FROM public.start_generation_job(c, 'lens_analysis', gen_random_uuid(), '{}', TRUE, 0, 60) AS s;
  PERFORM public.complete_generation_job(jx, '{"ok":true}', NULL);
  UPDATE public.generation_jobs SET deadline_at = now() - interval '31 seconds' WHERE id = jx;
  PERFORM public.fail_generation_job(jx, 'late', TRUE);
  PERFORM public.reap_generation_jobs(c);
  PERFORM public.reap_generation_jobs();
  SELECT * INTO r FROM public.generation_jobs WHERE id = jx;
  PERFORM pg_temp.expect(r.status = 'succeeded' AND r.credit_state = 'charged' AND pg_temp.purchased(c) = 0,
    'I2 completed job: no refund from fail or either reaper');

  -- I3 refund without a charge: two requests attached to one charged job
  -- (in_flight / existing replays) can only refund that one charge, once.
  UPDATE public.user_entitlements SET purchased_credits = 1 WHERE user_id = c;
  SELECT (s.job).id INTO jx FROM public.start_generation_job(c, 'dupe_search', gen_random_uuid(), '{}', TRUE, 0, 60) AS s;
  SELECT s.outcome, s.job INTO r FROM public.start_generation_job(c, 'dupe_search', gen_random_uuid(), '{}', TRUE, 0, 60) AS s;
  PERFORM pg_temp.expect(r.outcome = 'in_flight' AND (r.job).id = jx, 'I3 second request attached, not charged');
  PERFORM public.fail_generation_job(jx, 'provider_error', TRUE);   -- the request that started it
  PERFORM public.fail_generation_job((r.job).id, 'provider_error', TRUE);  -- the attached one
  PERFORM pg_temp.expect(pg_temp.purchased(c) = 1, 'I3 one charge, one refund, however many requests');

  -- I4 a free job (p_charge false, e.g. the free look image) is never refunded.
  SELECT (s.job).id INTO jx FROM public.start_generation_job(c, 'photo_preview', gen_random_uuid(), '{}', FALSE, 0, 60) AS s;
  PERFORM public.fail_generation_job(jx, 'provider_error', TRUE);
  UPDATE public.generation_jobs SET deadline_at = now() - interval '31 seconds' WHERE id = jx;
  PERFORM public.reap_generation_jobs(c);
  PERFORM pg_temp.expect(pg_temp.purchased(c) = 1 AND pg_temp.daily(c) = 0
                         AND (SELECT credit_state FROM public.generation_jobs WHERE id = jx) = 'none',
    'I4 free job: nothing refunded');
END;
$$;

SELECT pg_temp.bystander_unchanged('credit inflation checks');

-- ---------------------------------------------------------------------------
-- Nightly resets (review I3) with generation jobs: every night her whole
-- pool goes on jobs that fail after midnight; her first job of the new day
-- fails the same day. Four nights: the pool is never above the allowance.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  m CONSTANT UUID := '00000000-0000-4000-8000-0000000000e4';
  allowance CONSTANT INTEGER := 3;
  kinds CONSTANT TEXT[] := ARRAY['look', 'style_sheet', 'check_in'];
  jobs UUID[];
  pool INTEGER;
  night INTEGER;
  i INTEGER;
  j UUID;
BEGIN
  PERFORM pg_temp.set_balance(m, allowance, 0, current_date);
  FOR night IN 1..4 LOOP
    pool := pg_temp.daily(m);
    jobs := ARRAY[]::UUID[];
    FOR i IN 1..pool LOOP
      SELECT (s.job).id INTO j
        FROM public.start_generation_job(m, kinds[i], gen_random_uuid(), '{}', TRUE, allowance, 300) AS s;
      jobs := jobs || j;                                    -- 23:59:59
    END LOOP;
    PERFORM pg_temp.midnight(m);
    FOREACH j IN ARRAY jobs LOOP
      PERFORM public.fail_generation_job(j, 'provider_error', TRUE);   -- after 00:00: owed
    END LOOP;
    SELECT (s.job).id INTO j
      FROM public.start_generation_job(m, 'body_scan', gen_random_uuid(), '{}', TRUE, allowance, 300) AS s;
    PERFORM pg_temp.expect(pg_temp.daily(m) <= allowance,
      format('PA nightly reset (jobs) night %s: pool %s after the first job, never above %s', night, pg_temp.daily(m), allowance));
    PERFORM public.fail_generation_job(j, 'provider_error', TRUE);    -- same day
    PERFORM pg_temp.expect(pg_temp.daily(m) <= allowance AND pg_temp.purchased(m) = 0,
      format('PA nightly reset (jobs) night %s: pool %s after its same-day refund, never above %s; purchased 0',
             night, pg_temp.daily(m), allowance));
  END LOOP;
END;
$$;
SELECT pg_temp.bystander_unchanged('nightly reset checks');

-- ---------------------------------------------------------------------------
-- A look start spends an owed daily refund before any purchased credit, and
-- never raises a false insufficient_credits: a job refund, and (when the
-- tracked pair is applied) a refund owed by a tracked feature such as an item
-- read.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  m CONSTANT UUID := '00000000-0000-4000-8000-0000000000e5';
  j UUID;
  rc UUID;
  r RECORD;
BEGIN
  -- LS1 / LS2: owed by a generation job.
  PERFORM pg_temp.set_balance(m, 1, 1, current_date);
  SELECT (s.job).id INTO j FROM public.start_generation_job(m, 'style_sheet', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.midnight(m);
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  PERFORM pg_temp.set_balance(m, 0, 1, current_date);   -- today's credit used, 1 purchased
  SELECT s.outcome, s.job INTO r FROM public.start_generation_job(m, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND (r.job).charged_from = 'daily'
                         AND pg_temp.purchased(m) = 1 AND pg_temp.owed(m) = 0,
    'LS1 a look start spends an owed job refund before the purchased credit');
  PERFORM public.complete_generation_job((r.job).id, '{}', NULL);
  PERFORM pg_temp.set_balance(m, 1, 0, current_date);
  SELECT (s.job).id INTO j FROM public.start_generation_job(m, 'style_sheet', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.midnight(m);
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  PERFORM pg_temp.set_balance(m, 0, 0, current_date);
  SELECT s.outcome, s.job INTO r FROM public.start_generation_job(m, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND (r.job).charged_from = 'daily',
    'LS2 no false insufficient_credits: an owed job refund pays for the look');
  PERFORM public.complete_generation_job((r.job).id, '{}', NULL);

  IF to_regclass('public.ai_credit_spends') IS NULL THEN
    RAISE NOTICE 'skip: tracked credits not applied, LS3/LS4 not checked';
    RETURN;
  END IF;

  -- LS3 / LS4: owed by a tracked feature (review I2, probes B and B2).
  PERFORM pg_temp.set_balance(m, 1, 1, current_date);
  EXECUTE 'SELECT s.receipt_id FROM public.spend_ai_credit_tracked($1, 1) AS s' INTO rc USING m;
  PERFORM pg_temp.midnight(m);
  EXECUTE 'SELECT public.refund_ai_credit_tracked($1)' USING rc;
  PERFORM pg_temp.set_balance(m, 0, 1, current_date);
  SELECT s.outcome, s.job INTO r FROM public.start_generation_job(m, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND (r.job).charged_from = 'daily'
                         AND pg_temp.purchased(m) = 1 AND pg_temp.owed(m) = 0,
    'LS3 a look start spends a tracked feature''s owed refund before the purchased credit');
  PERFORM public.complete_generation_job((r.job).id, '{}', NULL);
  PERFORM pg_temp.set_balance(m, 1, 0, current_date);
  EXECUTE 'SELECT s.receipt_id FROM public.spend_ai_credit_tracked($1, 1) AS s' INTO rc USING m;
  PERFORM pg_temp.midnight(m);
  EXECUTE 'SELECT public.refund_ai_credit_tracked($1)' USING rc;
  PERFORM pg_temp.set_balance(m, 0, 0, current_date);
  SELECT s.outcome, s.job INTO r FROM public.start_generation_job(m, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND (r.job).charged_from = 'daily',
    'LS4 no false insufficient_credits: a tracked feature''s owed refund pays for the look');
  PERFORM public.complete_generation_job((r.job).id, '{}', NULL);
END;
$$;
SELECT pg_temp.bystander_unchanged('look-start checks');

-- ---------------------------------------------------------------------------
-- Two members: a start settles only its own member's owed refunds.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  x CONSTANT UUID := '00000000-0000-4000-8000-0000000000e7';
  j UUID;
  r RECORD;
BEGIN
  PERFORM pg_temp.set_balance(x, 1, 0, current_date);
  SELECT (s.job).id INTO j FROM public.start_generation_job(x, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.midnight(x);
  PERFORM public.fail_generation_job(j, 'provider_error', TRUE);
  PERFORM pg_temp.set_balance(x, 0, 0, current_date);
  PERFORM pg_temp.expect(pg_temp.owed(x) = 1 AND pg_temp.owed('00000000-0000-4000-8000-0000000000e0') >= 1,
    'TM both members have owed refunds');
  SELECT s.outcome, s.job INTO r FROM public.start_generation_job(x, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s;
  PERFORM pg_temp.expect(r.outcome = 'started' AND pg_temp.owed(x) = 0,
    'TM member X''s start settles X''s owed refund');
  PERFORM public.complete_generation_job((r.job).id, '{}', NULL);
END;
$$;
SELECT pg_temp.bystander_unchanged('two-member check (her owed refunds are still owed)');

-- ---------------------------------------------------------------------------
-- argument validation and constraints
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-00000000000a';
  before_daily INTEGER := pg_temp.daily(a);
  before_purchased INTEGER := pg_temp.purchased(a);
  j UUID;
BEGIN
  BEGIN
    PERFORM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000004', '{}', TRUE, 3, 60);
    RAISE EXCEPTION 'expected client_request_id_conflict';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'client_request_id_conflict', 'S21 a request id is bound to its kind');
  END;

  -- Kinds are validated inside start_generation_job (no table CHECK).
  BEGIN
    PERFORM public.start_generation_job(a, 'portrait', '11111111-1111-4111-8111-000000000012', '{}', TRUE, 3, 60);
    RAISE EXCEPTION 'expected invalid_generation_kind';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_generation_kind', 'S22 an unknown kind raises invalid_generation_kind');
  END;
  BEGIN
    PERFORM public.start_generation_job(a, NULL, '11111111-1111-4111-8111-000000000012', '{}', TRUE, 3, 60);
    RAISE EXCEPTION 'expected invalid_generation_kind';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_generation_kind', 'S22 a missing kind raises invalid_generation_kind');
  END;
  PERFORM pg_temp.expect(pg_temp.daily(a) = before_daily AND pg_temp.purchased(a) = before_purchased,
    'S22 nothing charged for an unknown kind');
  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM public.generation_jobs
                 WHERE client_request_id = '11111111-1111-4111-8111-000000000012'),
    'S22 no row recorded for an unknown kind');

  BEGIN
    PERFORM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000013', '{}', TRUE, 3, 0);
    RAISE EXCEPTION 'expected invalid_deadline_seconds';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_deadline_seconds', 'S23 deadline must be at least 1 s');
  END;
  BEGIN
    PERFORM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000013', '{}', TRUE, 3, 3601);
    RAISE EXCEPTION 'expected invalid_deadline_seconds';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_deadline_seconds', 'S23 deadline is capped at one hour');
  END;
  BEGIN
    PERFORM public.start_generation_job(a, 'look', NULL, '{}', TRUE, 3, 60);
    RAISE EXCEPTION 'expected invalid_client_request_id';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_client_request_id', 'S23 a request id is required');
  END;

  BEGIN
    PERFORM public.complete_generation_job('99999999-9999-4999-8999-999999999999', '{}', NULL);
    RAISE EXCEPTION 'expected generation_job_not_found';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'generation_job_not_found', 'S24 complete of an unknown job raises');
  END;
  BEGIN
    PERFORM public.fail_generation_job('99999999-9999-4999-8999-999999999999', 'x', TRUE);
    RAISE EXCEPTION 'expected generation_job_not_found';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'generation_job_not_found', 'S24 fail of an unknown job raises');
  END;

  -- Single flight is enforced by start_generation_job, not by the table:
  -- everything that may change later is replaceable without a DROP.
  SELECT (s.job).id INTO j
    FROM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000014', '{}', FALSE, 0, 60) AS s;
  PERFORM pg_temp.expect(
    (SELECT (s.job).id FROM public.start_generation_job(a, 'look', '11111111-1111-4111-8111-000000000015',
                                                       '{}', FALSE, 0, 60) AS s) = j,
    'S25 start enforces one running job per kind (in_flight)');
  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.generation_jobs'::regclass
                   AND contype = 'c'
                   AND pg_get_constraintdef(oid) ILIKE '%kind%'),
    'S25 no table CHECK on kind');
  PERFORM pg_temp.expect(
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = 'public.generation_jobs'::regclass AND i.indisunique)
      = ARRAY['generation_jobs_pkey', 'generation_jobs_user_request_key'],
    'S25 the only unique indexes are the primary key and the idempotency key');
  PERFORM pg_temp.expect(
    EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE i.indrelid = 'public.generation_jobs'::regclass
               AND c.relname = 'generation_jobs_running_user_kind_idx'
               AND NOT i.indisunique
               AND i.indpred IS NOT NULL),
    'S25 running jobs are indexed by a plain partial index');
  BEGIN
    INSERT INTO public.generation_jobs (user_id, kind, client_request_id, deadline_at, credit_state)
    VALUES (a, 'concierge', '11111111-1111-4111-8111-000000000016', now() + interval '1 minute', 'charged');
    RAISE EXCEPTION 'expected check_violation';
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.expect(TRUE, 'S25 a charge must name its bucket (structural CHECK kept)');
  END;
END;
$$;
SELECT pg_temp.bystander_unchanged('validation checks');

-- Every kind in the contract is accepted by start_generation_job.
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-00000000000a';
  k TEXT;
  o TEXT;
BEGIN
  FOREACH k IN ARRAY ARRAY[
    'look', 'style_sheet', 'photo_preview', 'color_read', 'check_in',
    'body_scan', 'lens_analysis', 'dupe_search', 'concierge', 'item_detection'
  ] LOOP
    SELECT s.outcome INTO o
      FROM public.start_generation_job(a, k, gen_random_uuid(), '{}', FALSE, 0, 60) AS s;
    PERFORM pg_temp.expect(o IN ('started', 'in_flight'), format('S22 kind %s is accepted', k));
  END LOOP;
END;
$$;
SELECT pg_temp.bystander_unchanged('kind checks');

-- ---------------------------------------------------------------------------
-- privileges
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn TEXT;
  role_name TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.start_generation_job(uuid,text,uuid,jsonb,boolean,integer,integer)',
    'public.complete_generation_job(uuid,jsonb,text)',
    'public.fail_generation_job(uuid,text,boolean)',
    'public.reap_generation_jobs(uuid)'
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      PERFORM pg_temp.expect(NOT has_function_privilege(role_name, fn, 'execute'), format('S26 %s cannot execute %s', role_name, fn));
    END LOOP;
    PERFORM pg_temp.expect(has_function_privilege('service_role', fn, 'execute'), format('S26 service_role can execute %s', fn));
    PERFORM pg_temp.expect(
      (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = fn::regprocedure)
      AND (SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_proc p WHERE p.oid = fn::regprocedure),
      format('S26 %s is SECURITY DEFINER with an empty search_path', fn));
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.expect(
      NOT has_function_privilege(role_name, 'public.refund_generation_job_credit(uuid)', 'execute'),
      format('S26 %s cannot call the refund helper directly', role_name));
    PERFORM pg_temp.expect(
      NOT has_function_privilege(role_name, 'public.apply_owed_generation_refunds(uuid,boolean)', 'execute'),
      format('S26 %s cannot call the owed-refund helper directly', role_name));
    PERFORM pg_temp.expect(
      NOT has_function_privilege(role_name, 'public.land_owed_daily_refunds(uuid,integer)', 'execute'),
      format('S26 %s cannot call the shared dispatcher directly', role_name));
  END LOOP;

  PERFORM pg_temp.expect(has_table_privilege('authenticated', 'public.generation_jobs', 'select'), 'S26 members may select');
  PERFORM pg_temp.expect(NOT has_table_privilege('authenticated', 'public.generation_jobs', 'insert')
                         AND NOT has_table_privilege('authenticated', 'public.generation_jobs', 'update')
                         AND NOT has_table_privilege('authenticated', 'public.generation_jobs', 'delete'),
    'S26 members may not insert, update or delete');
  PERFORM pg_temp.expect(NOT has_table_privilege('anon', 'public.generation_jobs', 'select'), 'S26 anon may not select');
  PERFORM pg_temp.expect((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.generation_jobs'::regclass), 'S26 RLS is on');
  PERFORM pg_temp.expect((SELECT NOT public FROM storage.buckets WHERE id = 'generations'), 'S26 generations bucket is private');
END;
$$;
SELECT pg_temp.bystander_unchanged('privilege checks');

-- Storage rows for the RLS check below.
INSERT INTO storage.objects (bucket_id, name)
VALUES ('generations', '00000000-0000-4000-8000-00000000000a/verify-a.jpg'),
       ('generations', '00000000-0000-4000-8000-00000000000b/verify-b.jpg');

-- ---------------------------------------------------------------------------
-- RLS as member B, then as member A
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000b', TRUE),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', TRUE);

DO $$
BEGIN
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM public.generation_jobs) = 3
    AND (SELECT bool_and(user_id = '00000000-0000-4000-8000-00000000000b') FROM public.generation_jobs)
    AND NOT EXISTS (SELECT 1 FROM public.generation_jobs
                     WHERE user_id IN ('00000000-0000-4000-8000-00000000000a',
                                       '00000000-0000-4000-8000-00000000000c')),
    'S27 member B sees her own three jobs and none of anyone else''s');
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM storage.objects WHERE bucket_id = 'generations') = 1,
    'S28 member B lists only her own generations folder');

  BEGIN
    INSERT INTO public.generation_jobs (user_id, kind, client_request_id, deadline_at)
    VALUES ('00000000-0000-4000-8000-00000000000b', 'look', gen_random_uuid(), now());
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'S27 a member cannot insert a job');
  END;
  BEGIN
    UPDATE public.generation_jobs SET credit_state = 'refunded';
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'S27 a member cannot update a job');
  END;
  BEGIN
    PERFORM public.start_generation_job('00000000-0000-4000-8000-00000000000b', 'look', gen_random_uuid(), '{}', FALSE, 0, 60);
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'S27 a member cannot call start_generation_job');
  END;
  BEGIN
    PERFORM public.reap_generation_jobs();
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'S27 a member cannot call reap_generation_jobs');
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('generations', '00000000-0000-4000-8000-00000000000b/forged.jpg');
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'S28 a member cannot write into the generations bucket');
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', TRUE),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', TRUE);

DO $$
BEGIN
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM public.generation_jobs) > 1
    AND (SELECT bool_and(user_id = '00000000-0000-4000-8000-00000000000a') FROM public.generation_jobs),
    'S27 member A sees only her own jobs');
  PERFORM pg_temp.expect(
    (SELECT array_agg(name) FROM storage.objects WHERE bucket_id = 'generations')
      = ARRAY['00000000-0000-4000-8000-00000000000a/verify-a.jpg'],
    'S28 member A reads only her own generations folder');
END;
$$;

RESET ROLE;
SELECT pg_temp.bystander_unchanged('the whole script');

\echo 'generation_jobs: all checks passed'

ROLLBACK;
