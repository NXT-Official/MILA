-- Generation jobs: a paid AI generation can no longer be lost (R7).
--
-- Root cause this closes: every paid generation (look, style sheet, portrait,
-- Lens, dupes, concierge...) charged a credit and persisted nothing. A member
-- who left the page, a retry, or a server killed at its time limit meant a
-- spent credit and no result, and a retry charged again.
--
-- What this adds (additive only; nothing existing is altered or removed):
--   * public.generation_jobs: one row per paid (or free) generation request.
--     The credit is taken in the SAME transaction that records the job, so a
--     charge without a job row cannot exist. Members can read their own rows;
--     only the four functions below write them.
--   * Private storage bucket `generations`: rendered images are stored at
--     `<user id>/<job id>.jpg` by the service role; a member can read only her
--     own folder (signed URLs), never write.
--   * SECURITY DEFINER functions, EXECUTE granted to service_role only:
--       start_generation_job(p_user_id uuid, p_kind text, p_client_request_id uuid,
--                            p_input jsonb, p_charge boolean,
--                            p_daily_allowance integer, p_deadline_seconds integer)
--         RETURNS TABLE (outcome text, job public.generation_jobs)
--       complete_generation_job(p_job_id uuid, p_result jsonb, p_image_path text)
--         RETURNS TABLE (outcome text, job public.generation_jobs)
--       fail_generation_job(p_job_id uuid, p_error_code text, p_refund boolean)
--         RETURNS TABLE (outcome text, job public.generation_jobs)
--       reap_generation_jobs(p_user_id uuid DEFAULT NULL)
--         RETURNS integer   -- number of jobs reaped
--     plus internal helpers no API role may execute:
--     refund_generation_job_credit(p_job_id uuid),
--     apply_owed_generation_refunds(p_user_id uuid, p_same_day_only boolean)
--     and the dispatcher shared with 20261007170000,
--     land_owed_daily_refunds(p_user_id uuid, p_pool_cap integer).
--
-- Calling them through PostgREST / supabase-js (service role):
--   The three job functions return exactly one row. Call them with `.single()`
--   (the same way consume_ai_credit is called) and `data` is
--     { "outcome": "<see below>", "job": { id, user_id, kind, client_request_id,
--       status, credit_state, charged_from, input, result, image_path,
--       error_code, deadline_at, created_at, completed_at, refund_applied_at } }
--   start_generation_job outcomes:
--     'started'   a new running job was recorded (and charged when p_charge):
--                 the caller runs the generation now.
--     'existing'  a job with this p_client_request_id already exists (running,
--                 succeeded or failed): no charge; replay job.result or report
--                 job.status. Reusing a request id for another kind raises
--                 'client_request_id_conflict'.
--     'in_flight' another request's job of this kind is still running: no
--                 charge; answer { status: 'running', jobId: job.id }.
--   complete_generation_job outcomes: 'completed' (running -> succeeded) or
--     'not_running' (already succeeded/failed, e.g. reaped: nothing written).
--   fail_generation_job outcomes: 'failed' (running -> failed) or
--     'not_running' (row unchanged). With p_refund the credit comes back
--     exactly once, whichever call gets there first (see "Credit rules").
--   Errors are raised as SQLSTATE P0001 with these messages:
--     'insufficient_credits'      no daily or purchased credit left (map to the
--                                 existing InsufficientCreditsError, unchanged)
--     'entitlements_not_found', 'invalid_daily_allowance'   (from consume_ai_credit)
--     'invalid_user_id', 'invalid_generation_kind', 'invalid_client_request_id',
--     'invalid_charge', 'invalid_deadline_seconds', 'client_request_id_conflict',
--     'generation_job_not_found', 'invalid_image_path'
--   Every argument error is raised before any credit is taken.
--
-- Credit rules (reused, not reimplemented): start_generation_job calls the
-- existing public.consume_ai_credit, so the spend order is unchanged: today's
-- allowance first (after the UTC daily reset), then purchased credits. The
-- bucket it came from is recorded in charged_from by comparing the purchased
-- balance before and after the call, under the same row lock. A failed or
-- reaped job gives the credit back, exactly once, but a refund never makes a
-- credit outlive its kind (owner: "never lose the token", and a refund
-- returns to the bucket the credit came from):
--   * purchased -> purchased_credits + 1, always;
--   * daily, taken today -> ai_credits + 1 in today's pool, in full, always
--                  (the owner's "never lose the token": a same-day failure
--                  always gives the credit back);
--   * daily, its day rolled over -> owed, and landed by the member's next
--                  spend CAPPED at that day's allowance:
--                  pool = min(allowance, current + owed). A daily credit was
--                  only ever usable on its own day; a pool that is already
--                  full absorbs it (settled, nothing added). So a
--                  rolled-over refund only tops today's daily credits up to
--                  the allowance, nothing compounds night after night, and
--                  it is never a purchased credit. Same-day refunds still
--                  return in full, so the daily balance can sit above the
--                  allowance for a while (credits spent after a top-up and
--                  refunded the same day). Purchased credits never change.
-- How it is reached safely: consume_ai_credit treats ai_credits as today's
-- pool only when credits_reset_at = CURRENT_DATE; on any other day it
-- overwrites ai_credits with the new allowance (and the daily sweep does
-- the same). Every landing therefore needs a pool stamped for today, and a
-- rolled-over landing also needs today's allowance, which only the two spend
-- paths know (start_generation_job here, spend_ai_credit_tracked in
-- 20261007170000). Both migrations define the same dispatcher,
-- land_owed_daily_refunds(p_user_id, p_pool_cap), which settles owed
-- refunds of BOTH features: a look start spends a refund owed by an item read
-- and the other way round. start_generation_job lands owed refunds before
-- consume_ai_credit (pool already stamped: cap = allowance) and after it
-- (fresh day: cap = allowance minus the allowance credit it just took, so a
-- fresh full pool absorbs them). The refund, fail and reap paths call it
-- without a cap: same-day refunds only. refund_applied_at records when an
-- owed refund was settled (landed or absorbed). A credit landed after the
-- spend that it should have paid for is swapped in, so the allowance is
-- still spent before purchased credits.
-- consume_ai_credit and grant_ai_credits are not modified.
--
-- Race safety (credit inflation): complete, fail and the reaper all lock the
-- job row before changing it (the reaper with SKIP LOCKED, leaving a row
-- someone else is finishing to them), and complete/fail only write a row
-- that is still 'running', so a job ends exactly once: succeeded or failed. A refund needs status 'failed' AND credit_state 'charged' in one
-- conditional UPDATE, so a completed job, a free job (p_charge false, never
-- charged) and an existing / in_flight replay (no charge of its own) are
-- never refunded, and a job is refunded at most once however many callers
-- race. An owed daily refund lands at most once (refund_applied_at). Every
-- balance write takes the user_entitlements row lock first.
--
-- Deadlines: a running job past deadline_at + 30 seconds is reaped (failed,
-- error_code 'deadline_exceeded', refunded). Pass p_deadline_seconds at least
-- the route's maximum duration, so a job is only reaped once the server that
-- ran it can no longer finish it. reap_generation_jobs() with no argument
-- reaps everyone (cron).
-- The server calls reap_generation_jobs(p_user_id) as its OWN call before
-- start_generation_job. start_generation_job reaps the member's overdue jobs
-- too, but when it then raises (for example insufficient_credits) its whole
-- transaction rolls back, that reap included; the separate call makes the
-- reap and its refunds stick either way.
--
-- Rules that may change later live in replaceable functions, not in table
-- constraints, because nothing here may ever be dropped:
--   * the list of valid kinds is checked in start_generation_job;
--   * "one running job per member and kind" is enforced in
--     start_generation_job under its per-member lock (the index on running
--     jobs is a plain, non-unique index), with the single-flight kinds listed
--     there; letting a kind run in parallel is a CREATE OR REPLACE;
--   * error_code length is bounded where it is written.
-- The table keeps CHECKs only for structural states (status, credit_state,
-- charged_from and their consistency). The job functions return
-- (outcome text, job public.generation_jobs), so a column added to the table
-- later flows through without changing any function's declared type.
--
-- Before applying, run `select version from supabase_migrations.schema_migrations where version in ('20261007143000','20261007170000');` (expect no rows).
-- Both files were edited in place while unapplied; if either version is
-- already recorded, stop: the edited file would not re-apply under the same
-- version, and forcing it would leave an ambiguous old dispatcher overload.
--
-- Apply order: after 20261006230000_founding_color_read_marker.sql; depends
-- only on 20260706102649_create_full_schema.sql (user_entitlements,
-- consume_ai_credit). Independent of every other pending migration.
--
-- Before it is applied: the app falls back to today's withAiCredit path
-- (charge first, refund on a thrown error) and reads of generation_jobs fail
-- with PGRST205 / 42P01, which the client treats as "not available yet".
-- After it is applied: generation routes record, persist and replay jobs; a
-- member who leaves, reloads or retries gets her result or her credit back.
--
-- Verify after applying (each should return the noted value):
--   select relrowsecurity from pg_class where oid = 'public.generation_jobs'::regclass;  -- true
--   select count(*) from pg_policies where tablename = 'generation_jobs';                  -- 1
--   select public from storage.buckets where id = 'generations';                           -- false
--   select count(*) from pg_policies where schemaname = 'storage'
--     and policyname = 'Generations: members read their own folder';                      -- 1
--   select has_function_privilege('authenticated',
--     'public.start_generation_job(uuid,text,uuid,jsonb,boolean,integer,integer)', 'execute');  -- false
--   select has_function_privilege('service_role',
--     'public.start_generation_job(uuid,text,uuid,jsonb,boolean,integer,integer)', 'execute');  -- true
--   select public.reap_generation_jobs();                                                   -- 0 on a fresh table
-- Full behavioural check (local Supabase only, rolls itself back):
--   scripts/verify-generation-jobs.sql
-- Two-session race checks (local Supabase only, commits throwaway members):
--   scripts/verify-generation-jobs-races.sh

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Valid kinds are checked in start_generation_job (replaceable), not here.
  kind TEXT NOT NULL,
  client_request_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CONSTRAINT generation_jobs_status_check CHECK (status IN ('running', 'succeeded', 'failed')),
  credit_state TEXT NOT NULL DEFAULT 'none'
    CONSTRAINT generation_jobs_credit_state_check CHECK (credit_state IN ('none', 'charged', 'refunded')),
  charged_from TEXT
    CONSTRAINT generation_jobs_charged_from_check CHECK (charged_from IN ('daily', 'purchased')),
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  image_path TEXT,
  error_code TEXT,
  deadline_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  -- When the refund was settled (landed, or absorbed by a full pool). NULL
  -- on a refunded job = a daily credit owed (see land_owed_daily_refunds).
  refund_applied_at TIMESTAMPTZ,
  CONSTRAINT generation_jobs_user_request_key UNIQUE (user_id, client_request_id),
  -- A charge always names its bucket; an uncharged job never does.
  CONSTRAINT generation_jobs_charge_bucket_check
    CHECK ((credit_state = 'none') = (charged_from IS NULL)),
  -- Finished exactly when it is no longer running.
  CONSTRAINT generation_jobs_completed_check
    CHECK ((status = 'running') = (completed_at IS NULL)),
  -- Only a refunded job can have its refund applied.
  CONSTRAINT generation_jobs_refund_applied_check
    CHECK (refund_applied_at IS NULL OR credit_state = 'refunded')
);

COMMENT ON TABLE public.generation_jobs IS
  'One row per AI generation request (R7). Written only by the start/complete/fail/reap_generation_job functions (service role); members read their own rows.';
COMMENT ON COLUMN public.generation_jobs.kind IS
  'look, style_sheet, photo_preview, color_read, check_in, body_scan, lens_analysis, dupe_search, concierge or item_detection. Validated by start_generation_job.';
COMMENT ON COLUMN public.generation_jobs.client_request_id IS
  'Idempotency key chosen by the client (or the server when an old client sends none). The same key never charges twice.';
COMMENT ON COLUMN public.generation_jobs.credit_state IS
  'none = free job; charged = one credit taken; refunded = that credit is being returned, exactly once (refund_applied_at says when it landed).';
COMMENT ON COLUMN public.generation_jobs.charged_from IS
  'Which bucket the credit came from (daily allowance or purchased). A refund returns it to the same kind of bucket: purchased to purchased, daily to the daily pool (never to purchased; a rolled-over one capped at the day''s allowance).';
COMMENT ON COLUMN public.generation_jobs.refund_applied_at IS
  'When the refund was settled. NULL while a refunded daily credit is owed: a same-day one lands in full once today''s pool is stamped; a rolled-over one is landed by the next spend, capped at that day''s allowance (absorbed by a full pool).';
COMMENT ON COLUMN public.generation_jobs.error_code IS
  'Machine-readable failure reason, at most 200 characters (bounded by the writing functions).';
COMMENT ON COLUMN public.generation_jobs.result IS
  'The persisted result JSON. Images are never inlined here: they live in storage at image_path.';
COMMENT ON COLUMN public.generation_jobs.image_path IS
  'Object path in the private generations bucket, always under the member''s own folder: <user id>/<job id>.jpg.';
COMMENT ON COLUMN public.generation_jobs.deadline_at IS
  'After deadline_at + 30 s a still-running job is reaped: failed and refunded.';

-- The member's latest job per kind (client polling) and the FK on user_id.
CREATE INDEX IF NOT EXISTS generation_jobs_user_kind_created_idx
  ON public.generation_jobs (user_id, kind, created_at DESC);

-- The member's running jobs per kind. Deliberately NOT unique: "one running
-- job per kind" is enforced in start_generation_job, where it can change.
CREATE INDEX IF NOT EXISTS generation_jobs_running_user_kind_idx
  ON public.generation_jobs (user_id, kind)
  WHERE status = 'running';

-- The cron reaper scans running jobs by deadline across all members.
CREATE INDEX IF NOT EXISTS generation_jobs_running_deadline_idx
  ON public.generation_jobs (deadline_at)
  WHERE status = 'running';

-- Daily credits owed back, per member (normally empty).
CREATE INDEX IF NOT EXISTS generation_jobs_owed_refunds_idx
  ON public.generation_jobs (user_id)
  WHERE credit_state = 'refunded' AND refund_applied_at IS NULL;

ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

-- Members read their own jobs; every write goes through the functions below.
REVOKE ALL ON TABLE public.generation_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.generation_jobs TO authenticated;
GRANT ALL ON TABLE public.generation_jobs TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'generation_jobs'
      AND policyname = 'generation_jobs_select_own'
  ) THEN
    CREATE POLICY generation_jobs_select_own ON public.generation_jobs
      FOR SELECT TO authenticated
      USING ((select auth.uid()) = user_id);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for rendered images
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('generations', 'generations', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Read-only for members, own folder only. No member insert/update/delete:
-- the service role writes, and bypasses RLS to do so.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Generations: members read their own folder'
  ) THEN
    CREATE POLICY "Generations: members read their own folder"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'generations'
        AND (storage.foldername(name))[1] = (select auth.uid())::text
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Internal: settle this table's owed daily refunds (claim only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_owed_generation_refunds(
  p_user_id UUID,
  p_same_day_only BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_settled INTEGER;
BEGIN
  -- Called only by land_owed_daily_refunds, which holds the member's balance
  -- row lock, decides how many of these credits land and adds them. This
  -- marks the member's owed daily refunds settled and counts them: those
  -- taken today (p_same_day_only), or every one. refund_applied_at IS NULL
  -- is the exactly-once guard; SKIP LOCKED leaves a row another transaction
  -- is refunding right now to that transaction.
  WITH owed AS (
    SELECT j.id
      FROM public.generation_jobs AS j
     WHERE j.user_id = p_user_id
       AND j.credit_state = 'refunded'
       AND j.charged_from = 'daily'
       AND j.refund_applied_at IS NULL
       AND (NOT coalesce(p_same_day_only, FALSE) OR j.created_at::date = current_date)
       FOR UPDATE SKIP LOCKED
  ), settled AS (
    UPDATE public.generation_jobs AS j
       SET refund_applied_at = now()
      FROM owed
     WHERE j.id = owed.id
    RETURNING j.id
  )
  SELECT count(*)::integer INTO v_settled FROM settled;

  RETURN v_settled;
END;
$$;

COMMENT ON FUNCTION public.apply_owed_generation_refunds(UUID, BOOLEAN) IS
  'Internal to land_owed_daily_refunds: marks the member''s owed daily job refunds settled (today''s only, or all) and returns how many. Does not touch the balance. Not executable by any API role.';

-- ---------------------------------------------------------------------------
-- Shared: land owed daily refunds in today's pool
-- IDENTICAL in 20261007143000_generation_jobs.sql and
-- 20261007170000_tracked_ai_credit_refunds.sql: whichever is applied last
-- leaves the same function, and either works alone, in either order.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.land_owed_daily_refunds(
  p_user_id UUID,
  p_pool_cap INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_reset_at DATE;
  v_pool INTEGER;
  v_owed INTEGER := 0;
  v_landed INTEGER;
BEGIN
  -- The balance row lock serialises every lander with consume_ai_credit,
  -- the daily sweep's write and every other refund for the member.
  SELECT e.credits_reset_at, e.ai_credits INTO v_reset_at, v_pool
    FROM public.user_entitlements AS e
   WHERE e.user_id = p_user_id
     FOR UPDATE;

  -- Only into a daily pool stamped for today: on any other day
  -- consume_ai_credit replaces ai_credits with the new allowance, which
  -- would wipe the credit. Until then everything stays owed.
  IF NOT FOUND OR v_reset_at IS DISTINCT FROM current_date THEN
    RETURN 0;
  END IF;

  -- Two modes.
  -- * No cap (the refund, fail and reap paths): a same-day refund, taken
  --   today and refunded into today's stamped pool, goes back in full.
  -- * A cap (the two spend paths, which know today's allowance): every owed
  --   refund is a credit whose day had rolled over, and it lands capped:
  --   pool = min(cap, current + owed). A daily credit was only ever usable on
  --   its own day; a pool that is already full absorbs it. A rolled-over
  --   refund therefore only tops today's daily credits up to the allowance,
  --   and nothing compounds; a same-day refund (no cap) returns in full and
  --   can leave the balance above the allowance for a while. Absorbed refunds
  --   are settled too, never purchased; purchased credits never change here.
  -- Each table is claimed through its own migration's helper, looked up at
  -- run time with a statement-level IF. Never CASE: a call is resolved when
  -- its statement is planned, so a CASE branch naming a function that does
  -- not exist raises 42883 even when it is not taken.
  IF to_regprocedure('public.apply_owed_ai_credit_refunds(uuid,boolean)') IS NOT NULL THEN
    v_owed := v_owed + public.apply_owed_ai_credit_refunds(p_user_id, p_pool_cap IS NULL);
  END IF;
  IF to_regprocedure('public.apply_owed_generation_refunds(uuid,boolean)') IS NOT NULL THEN
    v_owed := v_owed + public.apply_owed_generation_refunds(p_user_id, p_pool_cap IS NULL);
  END IF;

  IF p_pool_cap IS NULL THEN
    v_landed := v_owed;
  ELSE
    v_landed := LEAST(v_owed, GREATEST(p_pool_cap - v_pool, 0));
  END IF;

  IF v_landed > 0 THEN
    UPDATE public.user_entitlements AS e
       SET ai_credits = e.ai_credits + v_landed
     WHERE e.user_id = p_user_id;
  END IF;

  RETURN v_landed;
END;
$$;

COMMENT ON FUNCTION public.land_owed_daily_refunds(UUID, INTEGER) IS
  'Internal, shared by generation_jobs and the tracked credit pair: lands owed daily refunds in a pool stamped for today. No cap: same-day refunds in full. With a cap (spends): rolled-over refunds, pool = min(cap, current + owed), the rest absorbed. Returns how many credits were added. Not executable by any API role.';

-- ---------------------------------------------------------------------------
-- Internal: refund one job's credit, exactly once, to the same kind of bucket
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refund_generation_job_credit(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_charged_from TEXT;
BEGIN
  -- The conditional UPDATE is the exactly-once guard: of any number of
  -- concurrent callers, only the one that flips 'charged' gets a row back.
  -- status = 'failed' means a succeeded job is never refunded, and
  -- credit_state = 'charged' means a free job never is.
  UPDATE public.generation_jobs AS j
     SET credit_state = 'refunded',
         refund_applied_at = CASE WHEN j.charged_from = 'purchased' THEN now() END
   WHERE j.id = p_job_id
     AND j.status = 'failed'
     AND j.credit_state = 'charged'
  RETURNING j.user_id, j.charged_from
       INTO v_user_id, v_charged_from;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_charged_from = 'purchased' THEN
    -- Purchased credits never expire: straight back.
    UPDATE public.user_entitlements AS e
       SET purchased_credits = e.purchased_credits + 1
     WHERE e.user_id = v_user_id;
  ELSE
    -- A daily credit is never turned into a purchased credit. Taken today:
    -- back into today's pool now, in full. Taken on a day that has rolled
    -- over (or today's pool not stamped yet): owed, and the next spend lands
    -- it capped at the day's allowance (see land_owed_daily_refunds).
    PERFORM public.land_owed_daily_refunds(v_user_id);
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.refund_generation_job_credit(UUID) IS
  'Internal to fail_generation_job / reap_generation_jobs: refunds a failed, charged job exactly once. Purchased -> purchased; daily -> today''s pool if taken today, else owed and landed by the next spend capped at the day''s allowance; never purchased. Not executable by any API role.';

-- ---------------------------------------------------------------------------
-- reap_generation_jobs: overdue running jobs -> failed + refunded
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reap_generation_jobs(p_user_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job RECORD;
  v_reaped INTEGER := 0;
BEGIN
  -- SKIP LOCKED: a job some other call is finishing right now is left to it.
  -- A fixed order keeps two overlapping reapers from deadlocking.
  FOR v_job IN
    SELECT j.id
      FROM public.generation_jobs AS j
     WHERE j.status = 'running'
       AND j.deadline_at + interval '30 seconds' < now()
       AND (p_user_id IS NULL OR j.user_id = p_user_id)
     ORDER BY j.user_id, j.id
       FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.generation_jobs AS j
       SET status = 'failed',
           error_code = 'deadline_exceeded',
           completed_at = now()
     WHERE j.id = v_job.id
       AND j.status = 'running';

    IF FOUND THEN
      v_reaped := v_reaped + 1;
      PERFORM public.refund_generation_job_credit(v_job.id);
    END IF;
  END LOOP;

  -- For one member (the server calls this before every start), also land
  -- same-day refunds still owed to her. Rolled-over ones wait for the spend,
  -- which knows today's allowance.
  IF p_user_id IS NOT NULL THEN
    PERFORM public.land_owed_daily_refunds(p_user_id);
  END IF;

  RETURN v_reaped;
END;
$$;

COMMENT ON FUNCTION public.reap_generation_jobs(UUID) IS
  'Fails and refunds running jobs past deadline_at + 30 s, for one member or (NULL) everyone. Returns how many were reaped.';

-- ---------------------------------------------------------------------------
-- start_generation_job: idempotent start, single flight per kind, atomic charge
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_generation_job(
  p_user_id UUID,
  p_kind TEXT,
  p_client_request_id UUID,
  p_input JSONB,
  p_charge BOOLEAN,
  p_daily_allowance INTEGER,
  p_deadline_seconds INTEGER
)
RETURNS TABLE (outcome TEXT, job public.generation_jobs)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Every kind a job may have. Adding one is a CREATE OR REPLACE here.
  v_kinds CONSTANT TEXT[] := ARRAY[
    'look', 'style_sheet', 'photo_preview', 'color_read', 'check_in',
    'body_scan', 'lens_analysis', 'dupe_search', 'concierge', 'item_detection'
  ];
  -- Kinds that run one at a time per member: a second request while one runs
  -- attaches to it (in_flight). Remove a kind here to let it run in parallel.
  v_single_flight_kinds CONSTANT TEXT[] := ARRAY[
    'look', 'style_sheet', 'photo_preview', 'color_read', 'check_in',
    'body_scan', 'lens_analysis', 'dupe_search', 'concierge', 'item_detection'
  ];
  v_job public.generation_jobs%ROWTYPE;
  v_allowed BOOLEAN;
  v_landed INTEGER;
  v_spent_daily INTEGER;
  v_purchased_before INTEGER;
  v_purchased_mid INTEGER;
  v_purchased_after INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user_id';
  END IF;
  IF p_kind IS NULL OR NOT (p_kind = ANY (v_kinds)) THEN
    RAISE EXCEPTION 'invalid_generation_kind';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_client_request_id';
  END IF;
  IF p_charge IS NULL THEN
    RAISE EXCEPTION 'invalid_charge';
  END IF;
  IF p_deadline_seconds IS NULL OR p_deadline_seconds < 1 OR p_deadline_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid_deadline_seconds';
  END IF;

  -- One start at a time per member: a double press or two tabs cannot both
  -- see "nothing running" and both charge. This lock is what enforces one
  -- running job per kind (there is no unique index). Released at commit.
  PERFORM pg_advisory_xact_lock(hashtextextended('mila.generation_jobs:' || p_user_id::text, 0));

  -- Overdue jobs first, so a dead job neither blocks this kind nor keeps
  -- its credit. (Rolled back if this call raises; the server also calls
  -- reap_generation_jobs(p_user_id) on its own first, see the header.)
  PERFORM public.reap_generation_jobs(p_user_id);

  -- Same request again (retry, reload, double submit): never a second charge.
  SELECT j.* INTO v_job
    FROM public.generation_jobs AS j
   WHERE j.user_id = p_user_id
     AND j.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_job.kind <> p_kind THEN
      RAISE EXCEPTION 'client_request_id_conflict';
    END IF;
    RETURN QUERY SELECT 'existing'::text, v_job;
    RETURN;
  END IF;

  -- Another request of this kind is still running: attach to it, no charge.
  IF p_kind = ANY (v_single_flight_kinds) THEN
    SELECT j.* INTO v_job
      FROM public.generation_jobs AS j
     WHERE j.user_id = p_user_id
       AND j.kind = p_kind
       AND j.status = 'running'
     ORDER BY j.created_at DESC
     LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT 'in_flight'::text, v_job;
      RETURN;
    END IF;
  END IF;

  -- Record the job before charging: the charge below commits or rolls back
  -- together with this row, so a credit is never taken without a job.
  INSERT INTO public.generation_jobs AS j (user_id, kind, client_request_id, input, deadline_at)
  VALUES (
    p_user_id,
    p_kind,
    p_client_request_id,
    coalesce(p_input, '{}'::jsonb),
    now() + make_interval(secs => p_deadline_seconds)
  )
  RETURNING j.* INTO v_job;

  IF p_charge THEN
    -- Lock the balance, note the purchased count, then spend through the
    -- existing function (allowance first, then purchased) so the order and
    -- its errors stay exactly as they are today. p_daily_allowance reaches
    -- consume_ai_credit and nothing else; a free job (p_charge false) never
    -- touches the balance at all.
    SELECT e.purchased_credits INTO v_purchased_before
      FROM public.user_entitlements AS e
     WHERE e.user_id = p_user_id
       FOR UPDATE;

    -- Owed daily refunds (of either feature) land first when today's pool
    -- already exists, capped at the day's allowance, so a returned credit can
    -- pay for this request before any purchased credit.
    PERFORM public.land_owed_daily_refunds(p_user_id, p_daily_allowance);

    SELECT c.allowed INTO v_allowed
      FROM public.consume_ai_credit(p_user_id, p_daily_allowance) AS c;

    -- consume_ai_credit has now stamped today's pool (it does so even when it
    -- refuses), so refunds owed from an earlier day land against it, capped
    -- as if this spend had not happened yet: an allowance credit it just
    -- took still counts as in the pool. A fresh day's full pool therefore
    -- absorbs them. If it refused and one did land, spend again.
    SELECT e.purchased_credits INTO v_purchased_mid
      FROM public.user_entitlements AS e
     WHERE e.user_id = p_user_id;
    v_spent_daily := 0;
    IF coalesce(v_allowed, FALSE) AND v_purchased_mid = v_purchased_before THEN
      v_spent_daily := 1;
    END IF;
    v_landed := public.land_owed_daily_refunds(p_user_id, p_daily_allowance - v_spent_daily);
    IF NOT coalesce(v_allowed, FALSE) AND v_landed > 0 THEN
      SELECT c.allowed INTO v_allowed
        FROM public.consume_ai_credit(p_user_id, p_daily_allowance) AS c;
      v_landed := 0;
    END IF;

    IF NOT coalesce(v_allowed, FALSE) THEN
      RAISE EXCEPTION 'insufficient_credits';
    END IF;

    SELECT e.purchased_credits INTO v_purchased_after
      FROM public.user_entitlements AS e
     WHERE e.user_id = p_user_id;

    -- Allowance first, also for a refund that landed only after the spend:
    -- if this took a purchased credit while a daily one just landed, spend
    -- the daily one instead and keep the purchased one (net balance equal).
    IF v_purchased_after < v_purchased_before AND v_landed > 0 THEN
      UPDATE public.user_entitlements AS e
         SET ai_credits = e.ai_credits - 1,
             purchased_credits = e.purchased_credits + 1
       WHERE e.user_id = p_user_id;
      v_purchased_after := v_purchased_before;
    END IF;

    UPDATE public.generation_jobs AS j
       SET credit_state = 'charged',
           charged_from = CASE
             WHEN v_purchased_after < v_purchased_before THEN 'purchased'
             ELSE 'daily'
           END
     WHERE j.id = v_job.id
    RETURNING j.* INTO v_job;
  END IF;

  RETURN QUERY SELECT 'started'::text, v_job;
END;
$$;

COMMENT ON FUNCTION public.start_generation_job(UUID, TEXT, UUID, JSONB, BOOLEAN, INTEGER, INTEGER) IS
  'Starts (or replays, or attaches to) a generation job. outcome: started | existing | in_flight. Charges one credit via consume_ai_credit only on started with p_charge; raises insufficient_credits when none is left.';

-- ---------------------------------------------------------------------------
-- complete_generation_job: running -> succeeded, result persisted
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_generation_job(
  p_job_id UUID,
  p_result JSONB,
  p_image_path TEXT
)
RETURNS TABLE (outcome TEXT, job public.generation_jobs)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.generation_jobs%ROWTYPE;
BEGIN
  SELECT j.* INTO v_job
    FROM public.generation_jobs AS j
   WHERE j.id = p_job_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'generation_job_not_found';
  END IF;

  -- Only a running job completes. A reaped (failed, refunded) or already
  -- completed job is returned untouched.
  IF v_job.status <> 'running' THEN
    RETURN QUERY SELECT 'not_running'::text, v_job;
    RETURN;
  END IF;

  -- Images live in the member's own folder of the generations bucket, so a
  -- signed URL for image_path can never reach another member's file.
  IF p_image_path IS NOT NULL AND (
       p_image_path NOT LIKE v_job.user_id::text || '/%'
       OR strpos(p_image_path, '..') > 0
       OR length(p_image_path) > 512
     ) THEN
    RAISE EXCEPTION 'invalid_image_path';
  END IF;

  -- status = 'running' again here: the row lock above already guarantees
  -- it, and this keeps a refunded job from ever being completed even if
  -- that lock were lost in a later edit.
  UPDATE public.generation_jobs AS j
     SET status = 'succeeded',
         result = p_result,
         image_path = p_image_path,
         completed_at = now()
   WHERE j.id = p_job_id
     AND j.status = 'running'
  RETURNING j.* INTO v_job;
  IF NOT FOUND THEN
    SELECT j.* INTO v_job FROM public.generation_jobs AS j WHERE j.id = p_job_id;
    RETURN QUERY SELECT 'not_running'::text, v_job;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'completed'::text, v_job;
END;
$$;

COMMENT ON FUNCTION public.complete_generation_job(UUID, JSONB, TEXT) IS
  'Persists a running job''s result: outcome completed, or not_running when the job already finished (nothing written).';

-- ---------------------------------------------------------------------------
-- fail_generation_job: running -> failed, optional exactly-once refund
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fail_generation_job(
  p_job_id UUID,
  p_error_code TEXT,
  p_refund BOOLEAN
)
RETURNS TABLE (outcome TEXT, job public.generation_jobs)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.generation_jobs%ROWTYPE;
  v_outcome TEXT := 'not_running';
BEGIN
  SELECT j.* INTO v_job
    FROM public.generation_jobs AS j
   WHERE j.id = p_job_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'generation_job_not_found';
  END IF;

  IF v_job.status = 'running' THEN
    UPDATE public.generation_jobs AS j
       SET status = 'failed',
           error_code = coalesce(nullif(left(btrim(p_error_code), 200), ''), 'unknown'),
           completed_at = now()
     WHERE j.id = p_job_id
       AND j.status = 'running';
    IF FOUND THEN
      v_outcome := 'failed';
    END IF;
  END IF;

  -- Refunds only a failed job that still holds its charge, so a succeeded
  -- job is never refunded and a second call (or the reaper) refunds nothing.
  IF coalesce(p_refund, FALSE) THEN
    PERFORM public.refund_generation_job_credit(p_job_id);
  END IF;

  SELECT j.* INTO v_job
    FROM public.generation_jobs AS j
   WHERE j.id = p_job_id;

  RETURN QUERY SELECT v_outcome, v_job;
END;
$$;

COMMENT ON FUNCTION public.fail_generation_job(UUID, TEXT, BOOLEAN) IS
  'Marks a running job failed (outcome failed, else not_running) and, with p_refund, returns its credit exactly once: purchased to purchased, daily to the current day''s daily pool.';

-- ---------------------------------------------------------------------------
-- Privileges: service role only
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.start_generation_job(UUID, TEXT, UUID, JSONB, BOOLEAN, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_generation_job(UUID, TEXT, UUID, JSONB, BOOLEAN, INTEGER, INTEGER)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_generation_job(UUID, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_generation_job(UUID, JSONB, TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.fail_generation_job(UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_generation_job(UUID, TEXT, BOOLEAN)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.reap_generation_jobs(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_generation_jobs(UUID)
  TO service_role;

-- The refund helpers are reachable only through the functions above.
REVOKE EXECUTE ON FUNCTION public.refund_generation_job_credit(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.apply_owed_generation_refunds(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.land_owed_daily_refunds(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
