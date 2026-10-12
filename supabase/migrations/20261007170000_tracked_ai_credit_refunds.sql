-- Tracked AI credit spend and refund: a refund goes back to the bucket the
-- credit came from (CREDIT-REFUND-BUCKET).
--
-- Why: withAiCredit and payForLookImage spend through consume_ai_credit
-- (today's allowance first, then purchased) and refund through
-- grant_ai_credits, which does not know which bucket paid. With one receipt
-- per spend, a refund returns to the bucket the credit came from, and an
-- after-midnight daily refund only tops today's pool up to the allowance.
--
-- What this adds (additive only; consume_ai_credit, grant_ai_credits and the
-- generation_jobs functions are not modified):
--   * public.ai_credit_spends: one receipt per tracked spend (which bucket,
--     which credit day, whether and when it was refunded). RLS on, no member
--     access at all; only the functions below write it.
--   * spend_ai_credit_tracked(p_user_id uuid, p_daily_allowance integer)
--       RETURNS TABLE (allowed boolean, remaining integer, receipt_id uuid,
--                      bucket text, credit_day date)
--     Spends one credit through the existing consume_ai_credit (same order,
--     same allowance rule) and returns a receipt. allowed = false means no
--     credit was available: nothing recorded, no receipt (receipt_id NULL),
--     exactly like consume_ai_credit refusing.
--   * refund_ai_credit_tracked(p_receipt_id uuid) RETURNS text
--     'refunded'         the credit is back in its bucket now;
--     'owed'             a daily credit whose day has rolled over (or today's
--                        pool not stamped yet): settled by her next spend,
--                        capped at that day's allowance (see below);
--     'already_refunded' this receipt was refunded before: nothing changes.
--     Raises 'credit_receipt_not_found' (P0001) for an unknown or NULL id.
--   * Internal helpers no API role may execute:
--     apply_owed_ai_credit_refunds(p_user_id uuid, p_same_day_only boolean)
--     and the dispatcher shared with 20261007143000,
--     land_owed_daily_refunds(p_user_id uuid, p_pool_cap integer).
--   Both public functions: SECURITY DEFINER, search_path '', EXECUTE for
--   service_role only.
--
-- Refund rule (identical for generation jobs): a refund returns the credit,
-- but never lets it outlive its kind.
--   * purchased -> purchased_credits + 1, always;
--   * daily, spent today -> ai_credits + 1 in today's pool, in full, always
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
-- consume_ai_credit treats ai_credits as today's pool only when
-- credits_reset_at = CURRENT_DATE and replaces it with the new allowance on
-- any other day (the daily sweep does the same), so every landing needs a
-- pool stamped for today, and a rolled-over landing also needs today's
-- allowance, which only the two spend paths know (spend_ai_credit_tracked
-- here, start_generation_job in 20261007143000). Both migrations define the
-- same dispatcher, land_owed_daily_refunds(p_user_id, p_pool_cap), which
-- settles owed refunds of BOTH features, each through its own helper looked
-- up at run time with a statement-level IF (never CASE: a CASE branch naming
-- a missing function raises 42883 even when it is not taken). Either
-- migration works alone, in either order, and whichever is applied last
-- leaves the same dispatcher. The spend lands owed refunds before
-- consume_ai_credit (pool already stamped: cap = allowance) and after it
-- (fresh day: cap = allowance minus the allowance credit it just took, so a
-- fresh full pool absorbs them); the refund path calls it without a cap
-- (same-day refunds only). A credit that lands only after the spend it should
-- have paid for is swapped in, so the allowance is still spent before
-- purchased credits.
--
-- Exactly once: a receipt is refunded by one conditional UPDATE
-- (refunded_at IS NULL), and an owed daily refund is settled by another
-- (refund_applied_at IS NULL); concurrent callers can't both win. Every
-- balance write takes the user_entitlements row lock first, and receipt and
-- job rows are taken with SKIP LOCKED while that lock is held, so nothing
-- waits in a cycle.
--
-- Before applying, run `select version from supabase_migrations.schema_migrations where version in ('20261007143000','20261007170000');` (expect no rows).
-- Both files were edited in place while unapplied; if either version is
-- already recorded, stop: the edited file would not re-apply under the same
-- version, and forcing it would leave an ambiguous old dispatcher overload.
--
-- Apply order: after 20260706102649_create_full_schema.sql (user_entitlements,
-- consume_ai_credit). Independent of 20261007143000_generation_jobs.sql: each
-- works alone and both orders give the same functions.
--
-- Before it is applied: src/lib/credits.server.ts sees the missing function
-- (PGRST202 / 42883), remembers it for a few minutes and runs today's
-- consume_ai_credit + grant_ai_credits path unchanged.
-- After it is applied: withAiCredit and payForLookImage spend with a receipt
-- and refund to the bucket the credit came from.
--
-- Verify after applying:
--   select relrowsecurity from pg_class where oid = 'public.ai_credit_spends'::regclass;  -- true
--   select has_table_privilege('authenticated', 'public.ai_credit_spends', 'select');   -- false
--   select has_function_privilege('authenticated',
--     'public.spend_ai_credit_tracked(uuid,integer)', 'execute');                       -- false
--   select has_function_privilege('service_role',
--     'public.refund_ai_credit_tracked(uuid)', 'execute');                              -- true
-- Full behavioural check (local Supabase only, rolls itself back):
--   scripts/verify-tracked-ai-credits.sql
-- Two-session race checks (local Supabase only, commits throwaway members):
--   scripts/verify-tracked-ai-credits-races.sh

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_credit_spends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL
    CONSTRAINT ai_credit_spends_bucket_check CHECK (bucket IN ('daily', 'purchased')),
  credit_day DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When the refund was granted (NULL = not refunded).
  refunded_at TIMESTAMPTZ,
  -- When the refund was settled (landed, or absorbed by a full pool). NULL
  -- on a refunded daily credit = owed (see land_owed_daily_refunds).
  refund_applied_at TIMESTAMPTZ,
  CONSTRAINT ai_credit_spends_refund_applied_check
    CHECK (refund_applied_at IS NULL OR refunded_at IS NOT NULL)
);

COMMENT ON TABLE public.ai_credit_spends IS
  'One receipt per tracked AI credit spend: the bucket it came from, so a refund goes back there exactly once. Service role only; written by spend_ai_credit_tracked / refund_ai_credit_tracked.';
COMMENT ON COLUMN public.ai_credit_spends.credit_day IS
  'The credit day consume_ai_credit stamped for this spend (CURRENT_DATE, UTC on Supabase).';
COMMENT ON COLUMN public.ai_credit_spends.refund_applied_at IS
  'When the refund was settled. NULL while a refunded daily credit is owed: a same-day one lands in full once today''s pool is stamped; a rolled-over one is landed by the next spend, capped at that day''s allowance (absorbed by a full pool).';

-- The member's receipts, newest first; also the index on the user_id FK.
CREATE INDEX IF NOT EXISTS ai_credit_spends_user_created_idx
  ON public.ai_credit_spends (user_id, created_at DESC);

-- Daily credits owed back, per member (normally empty).
CREATE INDEX IF NOT EXISTS ai_credit_spends_owed_idx
  ON public.ai_credit_spends (user_id)
  WHERE refunded_at IS NOT NULL AND refund_applied_at IS NULL;

ALTER TABLE public.ai_credit_spends ENABLE ROW LEVEL SECURITY;

-- No member access (no policy, no grant); the service role and the functions
-- below only.
REVOKE ALL ON TABLE public.ai_credit_spends FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_credit_spends TO service_role;

-- ---------------------------------------------------------------------------
-- Internal: settle this table's owed daily refunds (claim only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_owed_ai_credit_refunds(
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
  -- marks the member's owed daily receipts settled and counts them: those
  -- spent today (p_same_day_only), or every one. refund_applied_at IS NULL is
  -- the exactly-once guard; SKIP LOCKED leaves a receipt another transaction
  -- is refunding right now to that transaction.
  WITH owed AS (
    SELECT s.id
      FROM public.ai_credit_spends AS s
     WHERE s.user_id = p_user_id
       AND s.bucket = 'daily'
       AND s.refunded_at IS NOT NULL
       AND s.refund_applied_at IS NULL
       AND (NOT coalesce(p_same_day_only, FALSE) OR s.credit_day = current_date)
       FOR UPDATE SKIP LOCKED
  ), settled AS (
    UPDATE public.ai_credit_spends AS s
       SET refund_applied_at = now()
      FROM owed
     WHERE s.id = owed.id
    RETURNING s.id
  )
  SELECT count(*)::integer INTO v_settled FROM settled;

  RETURN v_settled;
END;
$$;

COMMENT ON FUNCTION public.apply_owed_ai_credit_refunds(UUID, BOOLEAN) IS
  'Internal to land_owed_daily_refunds: marks the member''s owed daily receipts settled (today''s only, or all) and returns how many. Does not touch the balance. Not executable by any API role.';

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
-- spend_ai_credit_tracked
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.spend_ai_credit_tracked(
  p_user_id UUID,
  p_daily_allowance INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  receipt_id UUID,
  bucket TEXT,
  credit_day DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed BOOLEAN;
  v_landed INTEGER;
  v_spent_daily INTEGER;
  v_purchased_before INTEGER;
  v_purchased_mid INTEGER;
  v_purchased_after INTEGER;
  v_bucket TEXT;
  v_receipt UUID;
  v_remaining INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user_id';
  END IF;

  -- Lock the balance and note the purchased count; consume_ai_credit raises
  -- its own entitlements_not_found / invalid_daily_allowance unchanged.
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

  -- consume_ai_credit has now stamped today's pool (also when it refuses),
  -- so refunds owed from an earlier day land against it, capped as if this
  -- spend had not happened yet: an allowance credit it just took still
  -- counts as in the pool. A fresh day's full pool therefore absorbs them.
  -- If it refused and one did land, spend again.
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
    -- Same answer as consume_ai_credit refusing: nothing spent, no receipt.
    RETURN QUERY SELECT FALSE, 0, NULL::UUID, NULL::TEXT, NULL::DATE;
    RETURN;
  END IF;

  SELECT e.purchased_credits INTO v_purchased_after
    FROM public.user_entitlements AS e
   WHERE e.user_id = p_user_id;

  -- Allowance first, also for a refund that landed only after the spend:
  -- if this took a purchased credit while a daily one just landed, spend the
  -- daily one instead and keep the purchased one (net balance equal).
  IF v_purchased_after < v_purchased_before AND v_landed > 0 THEN
    UPDATE public.user_entitlements AS e
       SET ai_credits = e.ai_credits - 1,
           purchased_credits = e.purchased_credits + 1
     WHERE e.user_id = p_user_id;
    v_purchased_after := v_purchased_before;
  END IF;

  v_bucket := CASE WHEN v_purchased_after < v_purchased_before THEN 'purchased' ELSE 'daily' END;

  INSERT INTO public.ai_credit_spends AS s (user_id, bucket, credit_day)
  VALUES (p_user_id, v_bucket, current_date)
  RETURNING s.id INTO v_receipt;

  -- The day is stamped for today now, so ai_credits is today's pool.
  SELECT e.ai_credits + e.purchased_credits INTO v_remaining
    FROM public.user_entitlements AS e
   WHERE e.user_id = p_user_id;

  RETURN QUERY SELECT TRUE, v_remaining, v_receipt, v_bucket, current_date;
END;
$$;

COMMENT ON FUNCTION public.spend_ai_credit_tracked(UUID, INTEGER) IS
  'Spends one AI credit through consume_ai_credit and returns a receipt (bucket, credit day) for refund_ai_credit_tracked. allowed false: nothing spent, no receipt.';

-- ---------------------------------------------------------------------------
-- refund_ai_credit_tracked
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refund_ai_credit_tracked(p_receipt_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_bucket TEXT;
  v_applied_at TIMESTAMPTZ;
BEGIN
  -- The conditional UPDATE is the exactly-once guard: of any number of
  -- concurrent callers, only the one that sets refunded_at gets a row back.
  UPDATE public.ai_credit_spends AS s
     SET refunded_at = now(),
         refund_applied_at = CASE WHEN s.bucket = 'purchased' THEN now() END
   WHERE s.id = p_receipt_id
     AND s.refunded_at IS NULL
  RETURNING s.user_id, s.bucket INTO v_user_id, v_bucket;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.ai_credit_spends AS s WHERE s.id = p_receipt_id) THEN
      RETURN 'already_refunded';
    END IF;
    RAISE EXCEPTION 'credit_receipt_not_found';
  END IF;

  IF v_bucket = 'purchased' THEN
    -- Purchased credits never expire: straight back.
    UPDATE public.user_entitlements AS e
       SET purchased_credits = e.purchased_credits + 1
     WHERE e.user_id = v_user_id;
    RETURN 'refunded';
  END IF;

  -- A daily credit is never turned into a purchased credit. Spent today:
  -- back into today's pool now, in full. Spent on a day that has rolled over
  -- (or today's pool not stamped yet): owed, and the next spend lands it
  -- capped at the day's allowance (see land_owed_daily_refunds).
  PERFORM public.land_owed_daily_refunds(v_user_id);

  SELECT s.refund_applied_at INTO v_applied_at
    FROM public.ai_credit_spends AS s
   WHERE s.id = p_receipt_id;

  RETURN CASE WHEN v_applied_at IS NULL THEN 'owed' ELSE 'refunded' END;
END;
$$;

COMMENT ON FUNCTION public.refund_ai_credit_tracked(UUID) IS
  'Refunds one tracked spend exactly once: purchased -> purchased; daily spent today -> today''s pool; daily whose day rolled over -> owed, landed by the next spend capped at the day''s allowance; never purchased. Returns refunded | owed | already_refunded.';

-- ---------------------------------------------------------------------------
-- Privileges: service role only
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.spend_ai_credit_tracked(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_ai_credit_tracked(UUID, INTEGER)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_ai_credit_tracked(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_ai_credit_tracked(UUID)
  TO service_role;

-- The helpers are reachable only through the functions above.
REVOKE EXECUTE ON FUNCTION public.apply_owed_ai_credit_refunds(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.land_owed_daily_refunds(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
