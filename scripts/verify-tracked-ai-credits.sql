-- Behavioural check for supabase/migrations/20261007170000_tracked_ai_credit_refunds.sql
--
-- Run against a LOCAL Supabase database that has every migration applied, as
-- the `postgres` role:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify-tracked-ai-credits.sql
-- Works with or without 20261007143000_generation_jobs.sql applied (the
-- cross-feature checks run only when it is).
--
-- Everything runs in one transaction that ends in ROLLBACK: the test members
-- and their receipts never persist. Any failed expectation raises
-- "FAIL: ..." and psql stops with a non-zero exit code; a clean run ends with
-- "tracked ai credits: all checks passed".
--
-- Midnight is simulated per member by pg_temp.midnight(): her pool loses
-- today's stamp AND everything she spent moves one day back, which is what a
-- real midnight does relative to her rows. (The nightly reset check also
-- runs with the pool unstamped only.)
-- A bystander member, who never acts, is checked after every block: nothing
-- another member does may change her balance or what she is owed.
-- Races need two sessions: scripts/verify-tracked-ai-credits-races.sh.

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

-- One spend: returns the receipt id (NULL when refused).
CREATE FUNCTION pg_temp.spend(p_user UUID, p_allowance INTEGER) RETURNS UUID
LANGUAGE sql AS $$ SELECT s.receipt_id FROM public.spend_ai_credit_tracked(p_user, p_allowance) AS s $$;

-- Midnight for one member: her pool is no longer today's, and everything she
-- spent so far moved one day into the past.
CREATE FUNCTION pg_temp.midnight(p_user UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.user_entitlements SET credits_reset_at = credits_reset_at - 1 WHERE user_id = p_user;
  UPDATE public.ai_credit_spends SET credit_day = credit_day - 1 WHERE user_id = p_user;
  IF to_regclass('public.generation_jobs') IS NOT NULL THEN
    EXECUTE 'UPDATE public.generation_jobs SET created_at = created_at - interval ''1 day'' WHERE user_id = $1'
      USING p_user;
  END IF;
END;
$$;

-- Owed daily refunds of both features.
CREATE FUNCTION pg_temp.owed(p_user UUID) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  n INTEGER;
  g INTEGER := 0;
BEGIN
  SELECT count(*) INTO n FROM public.ai_credit_spends
   WHERE user_id = p_user AND bucket = 'daily' AND refunded_at IS NOT NULL AND refund_applied_at IS NULL;
  IF to_regclass('public.generation_jobs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.generation_jobs WHERE user_id = $1 AND charged_from = ''daily''
               AND credit_state = ''refunded'' AND refund_applied_at IS NULL'
      INTO g USING p_user;
  END IF;
  RETURN n + g;
END;
$$;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000d1',
   'authenticated', 'authenticated', 'tracked-a@example.test', '{"username":"verify_tracked_a"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000d2',
   'authenticated', 'authenticated', 'tracked-reset@example.test', '{"username":"verify_tracked_reset"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000d3',
   'authenticated', 'authenticated', 'tracked-bystander@example.test', '{"username":"verify_tracked_by"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000d4',
   'authenticated', 'authenticated', 'tracked-probe-a@example.test', '{"username":"verify_tracked_pa"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000d5',
   'authenticated', 'authenticated', 'tracked-probe-a2@example.test', '{"username":"verify_tracked_pa2"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000d6',
   'authenticated', 'authenticated', 'tracked-x@example.test', '{"username":"verify_tracked_x"}'::jsonb, now(), now());

-- ---------------------------------------------------------------------------
-- The bystander: a purchased balance, a pool stamped today, and owed daily
-- refunds (one receipt, plus one generation job when that table exists).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bystander CONSTANT UUID := '00000000-0000-4000-8000-0000000000d3';
  rc UUID;
  j UUID;
BEGIN
  -- Both charged before midnight and refunded after it, so both stay owed
  -- (a spend of hers in between would settle her own owed refunds).
  PERFORM pg_temp.set_balance(bystander, 2, 0, current_date);
  rc := pg_temp.spend(bystander, 2);
  IF to_regclass('public.generation_jobs') IS NOT NULL THEN
    EXECUTE $q$SELECT (s.job).id FROM public.start_generation_job($1, 'look', gen_random_uuid(), '{}', TRUE, 2, 300) AS s$q$
      INTO j USING bystander;
  END IF;
  PERFORM pg_temp.midnight(bystander);
  PERFORM public.refund_ai_credit_tracked(rc);
  IF j IS NOT NULL THEN
    EXECUTE 'SELECT 1 FROM public.fail_generation_job($1, ''provider_error'', TRUE)' USING j;
  END IF;
  PERFORM pg_temp.set_balance(bystander, 1, 2, current_date);   -- the sweep stamps her day
END;
$$;

CREATE TEMP TABLE bystander_before AS
SELECT e.ai_credits, e.purchased_credits, e.credits_reset_at,
       pg_temp.owed('00000000-0000-4000-8000-0000000000d3') AS owed
  FROM public.user_entitlements AS e
 WHERE e.user_id = '00000000-0000-4000-8000-0000000000d3';

CREATE FUNCTION pg_temp.bystander_unchanged(p_after TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.expect(
    (SELECT (e.ai_credits, e.purchased_credits, e.credits_reset_at,
             pg_temp.owed('00000000-0000-4000-8000-0000000000d3'))
            = (b.ai_credits, b.purchased_credits, b.credits_reset_at, b.owed)
       FROM public.user_entitlements AS e, pg_temp.bystander_before AS b
      WHERE e.user_id = '00000000-0000-4000-8000-0000000000d3'),
    'BY bystander untouched after ' || p_after);
END;
$$;

SELECT pg_temp.expect((SELECT owed = 1 + (to_regclass('public.generation_jobs') IS NOT NULL)::int AND purchased_credits = 2 FROM pg_temp.bystander_before),
  'BY the bystander starts with owed refunds and a purchased balance');

-- ---------------------------------------------------------------------------
-- spend: bucket, credit day, refusal
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-0000000000d1';
  r RECORD;
  n_before BIGINT;
BEGIN
  PERFORM pg_temp.set_balance(a, 1, 1, current_date);

  SELECT * INTO r FROM public.spend_ai_credit_tracked(a, 3) AS s;
  PERFORM pg_temp.expect(r.allowed AND r.bucket = 'daily' AND r.credit_day = current_date
                         AND r.receipt_id IS NOT NULL AND r.remaining = 1,
    'T1 the allowance is spent first; the receipt says daily, today');
  PERFORM pg_temp.expect(
    (SELECT bucket = 'daily' AND credit_day = current_date AND refunded_at IS NULL
       FROM public.ai_credit_spends WHERE id = r.receipt_id),
    'T1 the receipt is stored');

  SELECT * INTO r FROM public.spend_ai_credit_tracked(a, 3) AS s;
  PERFORM pg_temp.expect(r.allowed AND r.bucket = 'purchased' AND r.remaining = 0,
    'T2 then purchased; the receipt says purchased');

  SELECT count(*) INTO n_before FROM public.ai_credit_spends WHERE user_id = a;
  SELECT * INTO r FROM public.spend_ai_credit_tracked(a, 3) AS s;
  PERFORM pg_temp.expect(NOT r.allowed AND r.receipt_id IS NULL AND r.bucket IS NULL AND r.remaining = 0,
    'T3 out of credits: refused, no receipt');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.ai_credit_spends WHERE user_id = a) = n_before,
    'T3 nothing recorded for a refused spend');

  -- Refusal on an unstamped day stamps it, exactly as consume_ai_credit does.
  PERFORM pg_temp.set_balance(a, 5, 0, current_date - 1);
  SELECT * INTO r FROM public.spend_ai_credit_tracked(a, 0) AS s;
  PERFORM pg_temp.expect(NOT r.allowed
                         AND (SELECT credits_reset_at FROM public.user_entitlements WHERE user_id = a) = current_date
                         AND pg_temp.daily(a) = 0,
    'T3 a refusal stamps the new day like consume_ai_credit (stale allowance gone)');

  BEGIN
    PERFORM public.spend_ai_credit_tracked(a, -1);
    RAISE EXCEPTION 'expected invalid_daily_allowance';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_daily_allowance', 'T4 consume_ai_credit''s own errors pass through');
  END;
  BEGIN
    PERFORM public.spend_ai_credit_tracked(NULL, 3);
    RAISE EXCEPTION 'expected invalid_user_id';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'invalid_user_id', 'T4 a user id is required');
  END;
END;
$$;
SELECT pg_temp.bystander_unchanged('spend checks');

-- ---------------------------------------------------------------------------
-- refund: bucket, exactly once, the midnight rule (capped at the allowance)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-0000000000d1';
  rc UUID;
  rc_old UUID;
  outcome TEXT;
  r RECORD;
BEGIN
  -- Same-day daily refund goes back to the daily pool; purchased untouched.
  PERFORM pg_temp.set_balance(a, 2, 4, current_date);
  rc := pg_temp.spend(a, 3);
  outcome := public.refund_ai_credit_tracked(rc);
  PERFORM pg_temp.expect(outcome = 'refunded' AND pg_temp.daily(a) = 2 AND pg_temp.purchased(a) = 4,
    'T5 same-day daily refund: back to the daily pool, purchased untouched');
  outcome := public.refund_ai_credit_tracked(rc);
  PERFORM pg_temp.expect(outcome = 'already_refunded' AND pg_temp.daily(a) = 2 AND pg_temp.purchased(a) = 4,
    'T6 a second refund of the same receipt changes nothing');

  -- Purchased refund goes back to purchased.
  PERFORM pg_temp.set_balance(a, 0, 4, current_date);
  rc := pg_temp.spend(a, 0);
  PERFORM pg_temp.expect(pg_temp.purchased(a) = 3, 'T7 charged from purchased');
  outcome := public.refund_ai_credit_tracked(rc);
  PERFORM pg_temp.expect(outcome = 'refunded' AND pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 4,
    'T7 purchased refund: back to purchased');
  PERFORM public.refund_ai_credit_tracked(rc);
  PERFORM pg_temp.expect(pg_temp.purchased(a) = 4, 'T7 exactly once');

  -- Rolled over, today's pool already full (the sweep stamped it): owed, and
  -- the next spend's full pool absorbs it. Never above the allowance, never
  -- purchased.
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  rc := pg_temp.spend(a, 1);
  PERFORM pg_temp.midnight(a);
  PERFORM pg_temp.set_balance(a, 3, 0, current_date);   -- the sweep
  outcome := public.refund_ai_credit_tracked(rc);
  PERFORM pg_temp.expect(outcome = 'owed' AND pg_temp.daily(a) = 3 AND pg_temp.purchased(a) = 0,
    'T8 a rolled-over refund is owed (only a spend knows the cap), never purchased');
  rc := pg_temp.spend(a, 3);
  PERFORM pg_temp.expect(pg_temp.daily(a) = 2 AND pg_temp.purchased(a) = 0 AND pg_temp.owed(a) = 0,
    'T8 a full pool absorbs it: pool never above the allowance');

  -- Rolled over, today's pool not stamped yet: owed, nothing written.
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  rc := pg_temp.spend(a, 1);
  PERFORM pg_temp.midnight(a);
  outcome := public.refund_ai_credit_tracked(rc);
  PERFORM pg_temp.expect(outcome = 'owed' AND pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 0,
    'T9 rolled-over refund on an unstamped day is owed, not purchased');
  PERFORM pg_temp.expect(public.refund_ai_credit_tracked(rc) = 'already_refunded',
    'T9 refunding it again does not double it');

  -- Her first spend of the new day (allowance 3): the fresh full pool absorbs
  -- it (3 - 1, nothing added), and it is settled once.
  rc := pg_temp.spend(a, 3);
  PERFORM pg_temp.expect(pg_temp.daily(a) = 2 AND pg_temp.purchased(a) = 0 AND pg_temp.owed(a) = 0,
    'T10 the first spend of a fresh day absorbs a rolled-over refund (pool never above the allowance)');
  rc := pg_temp.spend(a, 3);
  PERFORM pg_temp.expect(pg_temp.daily(a) = 1, 'T10 and settles it only once');
  PERFORM pg_temp.midnight(a);
  rc := pg_temp.spend(a, 3);
  PERFORM pg_temp.expect(pg_temp.daily(a) = 2 AND pg_temp.purchased(a) = 0, 'T10 a new day starts from the allowance');

  -- A rolled-over refund refills a pool she already used today, up to the
  -- allowance, and pays before a purchased credit (no false refusal).
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  rc_old := pg_temp.spend(a, 1);
  PERFORM pg_temp.midnight(a);
  PERFORM public.refund_ai_credit_tracked(rc_old);       -- owed
  PERFORM pg_temp.set_balance(a, 0, 1, current_date);    -- today's 1 already used; 1 purchased
  SELECT * INTO r FROM public.spend_ai_credit_tracked(a, 1) AS s;
  PERFORM pg_temp.expect(r.allowed AND r.bucket = 'daily' AND pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 1,
    'T11 an owed refund refills a used pool and pays before purchased');
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  rc_old := pg_temp.spend(a, 1);
  PERFORM pg_temp.midnight(a);
  PERFORM public.refund_ai_credit_tracked(rc_old);
  PERFORM pg_temp.set_balance(a, 0, 0, current_date);
  SELECT * INTO r FROM public.spend_ai_credit_tracked(a, 1) AS s;
  PERFORM pg_temp.expect(r.allowed AND r.bucket = 'daily' AND pg_temp.daily(a) = 0,
    'T11 no false refusal: the owed refund pays when nothing else is left');

  -- Allowance 0 today (plan lapsed): the cap is 0, so a rolled-over refund is
  -- absorbed (by ruling), and nothing becomes purchased.
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  rc_old := pg_temp.spend(a, 1);
  PERFORM pg_temp.midnight(a);
  PERFORM public.refund_ai_credit_tracked(rc_old);
  SELECT * INTO r FROM public.spend_ai_credit_tracked(a, 0) AS s;
  PERFORM pg_temp.expect(NOT r.allowed AND pg_temp.daily(a) = 0 AND pg_temp.purchased(a) = 0 AND pg_temp.owed(a) = 0,
    'T12 allowance 0: the rolled-over refund is absorbed (pool capped at 0), never purchased');

  -- The refund path lands same-day refunds only; a rolled-over one waits.
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  rc_old := pg_temp.spend(a, 1);
  PERFORM pg_temp.midnight(a);
  PERFORM public.refund_ai_credit_tracked(rc_old);       -- owed (rolled over)
  PERFORM pg_temp.set_balance(a, 2, 0, current_date);
  rc := pg_temp.spend(a, 2);                             -- pre-landing: pool 2, room 0 -> absorbed
  PERFORM pg_temp.expect(pg_temp.daily(a) = 1 AND pg_temp.owed(a) = 0,
    'T13 a spend on a full pool settles the rolled-over refund without adding to it');
  outcome := public.refund_ai_credit_tracked(rc);
  PERFORM pg_temp.expect(outcome = 'refunded' AND pg_temp.daily(a) = 2,
    'T13 a same-day refund still comes back in full');

  BEGIN
    PERFORM public.refund_ai_credit_tracked('99999999-9999-4999-8999-999999999999');
    RAISE EXCEPTION 'expected credit_receipt_not_found';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'credit_receipt_not_found', 'T14 an unknown receipt raises');
  END;
  BEGIN
    PERFORM public.refund_ai_credit_tracked(NULL);
    RAISE EXCEPTION 'expected credit_receipt_not_found';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.expect(SQLERRM = 'credit_receipt_not_found', 'T14 a NULL receipt raises');
  END;
END;
$$;
SELECT pg_temp.bystander_unchanged('refund checks');

-- ---------------------------------------------------------------------------
-- repeated refunds, same day and across the daily reset (review e1, I3)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f CONSTANT UUID := '00000000-0000-4000-8000-0000000000d2';
  allowance CONSTANT INTEGER := 3;
  r1 UUID;
  r2 UUID;
  r3 UUID;
BEGIN
  -- Same day: spend all 3 and refund each. Each refund returns to the bucket
  -- the credit came from.
  PERFORM pg_temp.set_balance(f, allowance, 0, current_date);
  r1 := pg_temp.spend(f, allowance);
  PERFORM public.refund_ai_credit_tracked(r1);
  r2 := pg_temp.spend(f, allowance);
  PERFORM public.refund_ai_credit_tracked(r2);
  r3 := pg_temp.spend(f, allowance);
  PERFORM public.refund_ai_credit_tracked(r3);
  PERFORM pg_temp.expect(pg_temp.daily(f) = allowance AND pg_temp.purchased(f) = 0,
    'F1 same-day refunds: allowance intact, zero purchased gained');

  -- Across midnight: spend all 3; the refunds arrive after midnight.
  r1 := pg_temp.spend(f, allowance);
  r2 := pg_temp.spend(f, allowance);
  r3 := pg_temp.spend(f, allowance);
  PERFORM pg_temp.midnight(f);
  PERFORM public.refund_ai_credit_tracked(r1);
  PERFORM public.refund_ai_credit_tracked(r2);
  PERFORM public.refund_ai_credit_tracked(r3);
  PERFORM pg_temp.expect(pg_temp.purchased(f) = 0, 'F2 zero purchased gained across midnight');
  PERFORM pg_temp.spend(f, allowance);
  PERFORM pg_temp.expect(pg_temp.daily(f) = allowance - 1 AND pg_temp.purchased(f) = 0,
    'F2 next day: the fresh pool absorbs them, never above the allowance, zero purchased');
  PERFORM public.refund_ai_credit_tracked(r1);
  PERFORM public.refund_ai_credit_tracked(r2);
  PERFORM pg_temp.expect(pg_temp.daily(f) = allowance - 1, 'F2 repeated refunds settle nothing twice');
  PERFORM pg_temp.midnight(f);
  PERFORM pg_temp.spend(f, allowance);
  PERFORM pg_temp.expect(pg_temp.daily(f) = allowance - 1 AND pg_temp.purchased(f) = 0,
    'F3 the following day starts from the allowance');
END;
$$;
SELECT pg_temp.bystander_unchanged('repeated refund checks');

-- Nightly resets (review I3): every night her whole pool is spent before
-- midnight and refunded after it; her first request of the new day is
-- refunded too. Four nights running.
-- PA1 with a faithful midnight, PA2 with the pool unstamped only.
CREATE FUNCTION pg_temp.probe_a(p_user UUID, p_faithful BOOLEAN, p_label TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  allowance CONSTANT INTEGER := 3;
  receipts UUID[];
  pool INTEGER;
  night INTEGER;
  i INTEGER;
  rc UUID;
BEGIN
  PERFORM pg_temp.set_balance(p_user, allowance, 0, current_date);
  FOR night IN 1..4 LOOP
    pool := pg_temp.daily(p_user);
    receipts := ARRAY[]::UUID[];
    FOR i IN 1..pool LOOP
      receipts := receipts || pg_temp.spend(p_user, allowance);   -- 23:59:59
    END LOOP;
    IF p_faithful THEN
      PERFORM pg_temp.midnight(p_user);
    ELSE
      UPDATE public.user_entitlements SET credits_reset_at = current_date - 1 WHERE user_id = p_user;
    END IF;
    FOREACH rc IN ARRAY receipts LOOP
      PERFORM public.refund_ai_credit_tracked(rc);                 -- after 00:00: owed
    END LOOP;
    rc := pg_temp.spend(p_user, allowance);                        -- first request of the day
    PERFORM pg_temp.expect(pg_temp.daily(p_user) <= allowance,
      format('%s night %s: pool %s after the first spend, never above the allowance %s',
             p_label, night, pg_temp.daily(p_user), allowance));
    PERFORM public.refund_ai_credit_tracked(rc);                   -- refunded the same day
    PERFORM pg_temp.expect(pg_temp.daily(p_user) <= allowance AND pg_temp.purchased(p_user) = 0,
      format('%s night %s: pool %s after its same-day refund, never above %s; purchased 0',
             p_label, night, pg_temp.daily(p_user), allowance));
  END LOOP;
END;
$$;
SELECT pg_temp.probe_a('00000000-0000-4000-8000-0000000000d4', TRUE, 'PA1 nightly reset (faithful midnight)');
SELECT pg_temp.probe_a('00000000-0000-4000-8000-0000000000d5', FALSE, 'PA2 nightly reset (pool unstamped only)');
SELECT pg_temp.bystander_unchanged('nightly reset checks');

-- ---------------------------------------------------------------------------
-- two members: each spend settles only its own member's owed refunds
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  x CONSTANT UUID := '00000000-0000-4000-8000-0000000000d6';
  rc UUID;
  r RECORD;
BEGIN
  PERFORM pg_temp.set_balance(x, 1, 0, current_date);
  rc := pg_temp.spend(x, 1);
  PERFORM pg_temp.midnight(x);
  PERFORM public.refund_ai_credit_tracked(rc);
  PERFORM pg_temp.set_balance(x, 0, 0, current_date);   -- she used today's credit
  PERFORM pg_temp.expect(pg_temp.owed(x) = 1 AND pg_temp.owed('00000000-0000-4000-8000-0000000000d3') >= 1,
    'TM both members have owed refunds');
  SELECT * INTO r FROM public.spend_ai_credit_tracked(x, 1) AS s;
  PERFORM pg_temp.expect(r.allowed AND pg_temp.owed(x) = 0,
    'TM member X''s spend settles X''s owed refund');
END;
$$;
SELECT pg_temp.bystander_unchanged('two-member check (her owed refunds are still owed)');

-- ---------------------------------------------------------------------------
-- cross-feature landing (only when generation_jobs is applied)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  a CONSTANT UUID := '00000000-0000-4000-8000-0000000000d1';
  j UUID;
  r RECORD;
BEGIN
  IF to_regclass('public.generation_jobs') IS NULL THEN
    RAISE NOTICE 'skip: generation_jobs not applied, cross-feature landing not checked';
    RETURN;
  END IF;
  PERFORM pg_temp.set_balance(a, 1, 0, current_date);
  EXECUTE $q$SELECT (s.job).id FROM public.start_generation_job($1, 'look', gen_random_uuid(), '{}', TRUE, 1, 300) AS s$q$
    INTO j USING a;
  PERFORM pg_temp.midnight(a);
  EXECUTE 'SELECT 1 FROM public.fail_generation_job($1, ''provider_error'', TRUE)' USING j;
  PERFORM pg_temp.set_balance(a, 0, 1, current_date);   -- today's credit used, 1 purchased
  SELECT * INTO r FROM public.spend_ai_credit_tracked(a, 1) AS s;
  PERFORM pg_temp.expect(r.allowed AND r.bucket = 'daily' AND pg_temp.purchased(a) = 1 AND pg_temp.owed(a) = 0,
    'T15 a tracked spend settles a generation job''s owed refund and spends it before purchased');
END;
$$;
SELECT pg_temp.bystander_unchanged('cross-feature landing');

-- ---------------------------------------------------------------------------
-- privileges
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn TEXT;
  role_name TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.spend_ai_credit_tracked(uuid,integer)',
    'public.refund_ai_credit_tracked(uuid)'
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      PERFORM pg_temp.expect(NOT has_function_privilege(role_name, fn, 'execute'),
        format('T16 %s cannot execute %s', role_name, fn));
    END LOOP;
    PERFORM pg_temp.expect(has_function_privilege('service_role', fn, 'execute'),
      format('T16 service_role can execute %s', fn));
    PERFORM pg_temp.expect(
      (SELECT p.prosecdef AND 'search_path=""' = ANY (p.proconfig) FROM pg_proc p WHERE p.oid = fn::regprocedure),
      format('T16 %s is SECURITY DEFINER with an empty search_path', fn));
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'public.apply_owed_ai_credit_refunds(uuid,boolean)',
    'public.land_owed_daily_refunds(uuid,integer)'
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      PERFORM pg_temp.expect(NOT has_function_privilege(role_name, fn, 'execute'),
        format('T16 %s cannot call the internal %s', role_name, fn));
    END LOOP;
  END LOOP;
  PERFORM pg_temp.expect((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_credit_spends'::regclass),
    'T16 RLS is on for ai_credit_spends');
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.expect(
      NOT has_table_privilege(role_name, 'public.ai_credit_spends', 'select')
      AND NOT has_table_privilege(role_name, 'public.ai_credit_spends', 'insert')
      AND NOT has_table_privilege(role_name, 'public.ai_credit_spends', 'update'),
      format('T16 %s has no access to ai_credit_spends', role_name));
  END LOOP;
END;
$$;

-- A member can neither read receipts nor spend or refund herself.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d1', TRUE),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', TRUE);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.ai_credit_spends;
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'T17 a member cannot read receipts');
  END;
  BEGIN
    PERFORM public.spend_ai_credit_tracked('00000000-0000-4000-8000-0000000000d1', 3);
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'T17 a member cannot spend through the RPC');
  END;
  BEGIN
    PERFORM public.refund_ai_credit_tracked('99999999-9999-4999-8999-999999999999');
    RAISE EXCEPTION 'expected insufficient_privilege';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.expect(TRUE, 'T17 a member cannot refund through the RPC');
  END;
END;
$$;
RESET ROLE;
SELECT pg_temp.bystander_unchanged('the whole script');

\echo 'tracked ai credits: all checks passed'

ROLLBACK;
