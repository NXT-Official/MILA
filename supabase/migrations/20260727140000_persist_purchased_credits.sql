-- ============================================================================
-- Purchased credits survive the daily reset.
--
-- consume_ai_credit overwrites ai_credits with the caller's daily allowance on
-- the first call of each new day. That is correct for an allowance, but it also
-- destroyed anything a user had bought: a 50-credit pack was gone by morning.
-- Harmless-looking while the free tier was 5/day, fatal now that it is 0 — the
-- only credits a free user can have are ones they paid for.
--
-- Two buckets in one row: ai_credits is the resettable daily allowance,
-- purchased_credits is permanent until spent. Spend order is allowance first,
-- since that is the balance about to expire anyway.
-- ============================================================================

ALTER TABLE public.user_entitlements
  ADD COLUMN purchased_credits INTEGER NOT NULL DEFAULT 0
    CHECK (purchased_credits >= 0);

-- Rescue credits already bought under the old single-bucket model: anything
-- above today's allowance for a user who has actually purchased a pack is
-- theirs. Users with no purchase row are left alone — their leftover free-tier
-- credits are meant to lapse.
WITH allowance AS (
  SELECT
    e.user_id,
    COALESCE((
      SELECT sp.credits_included
      FROM public.subscriptions s
      JOIN public.subscription_plans sp ON sp.id = s.plan_id
      WHERE s.user_id = e.user_id
        AND s.status IN ('active', 'trialing', 'past_due')
      ORDER BY s.updated_at DESC
      LIMIT 1
    ), 0) AS daily
  FROM public.user_entitlements e
)
UPDATE public.user_entitlements e
SET
  purchased_credits = e.ai_credits - a.daily,
  ai_credits = a.daily
FROM allowance a
WHERE a.user_id = e.user_id
  AND e.ai_credits > a.daily
  AND EXISTS (
    SELECT 1 FROM public.credit_pack_purchases c WHERE c.user_id = e.user_id
  );

CREATE OR REPLACE FUNCTION public.consume_ai_credit(
  _user_id UUID,
  _daily_allowance INTEGER
)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _today DATE := CURRENT_DATE;
  _daily INTEGER;
  _purchased INTEGER;
  _reset_at DATE;
BEGIN
  IF _daily_allowance IS NULL OR _daily_allowance < 0 THEN
    RAISE EXCEPTION 'invalid_daily_allowance';
  END IF;

  -- Row lock: concurrent calls for the same user serialize here, so two
  -- requests racing can never both observe pre-reset/pre-decrement credits.
  SELECT ai_credits, purchased_credits, credits_reset_at
    INTO _daily, _purchased, _reset_at
  FROM public.user_entitlements
  WHERE user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'entitlements_not_found';
  END IF;

  IF _reset_at IS DISTINCT FROM _today THEN
    _daily := _daily_allowance;
  END IF;

  IF _daily > 0 THEN
    _daily := _daily - 1;
  ELSIF _purchased > 0 THEN
    _purchased := _purchased - 1;
  ELSE
    -- Nothing to spend. Still bank the reset so the next call this day is a
    -- straight read of an already-zeroed allowance.
    UPDATE public.user_entitlements
    SET ai_credits = _daily, credits_reset_at = _today
    WHERE user_id = _user_id;
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  UPDATE public.user_entitlements
  SET ai_credits = _daily, purchased_credits = _purchased, credits_reset_at = _today
  WHERE user_id = _user_id;

  RETURN QUERY SELECT true, _daily + _purchased;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_ai_credits(
  _user_id UUID,
  _daily_allowance INTEGER,
  _amount INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _today DATE := CURRENT_DATE;
  _daily INTEGER;
  _purchased INTEGER;
  _reset_at DATE;
BEGIN
  IF _daily_allowance IS NULL OR _daily_allowance < 0 THEN
    RAISE EXCEPTION 'invalid_daily_allowance';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT ai_credits, purchased_credits, credits_reset_at
    INTO _daily, _purchased, _reset_at
  FROM public.user_entitlements
  WHERE user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'entitlements_not_found';
  END IF;

  -- Same day-reset as consume_ai_credit, so a purchase made before the user's
  -- first credit-consuming action of the day doesn't stack the grant on top of
  -- a stale (yesterday's) allowance.
  IF _reset_at IS DISTINCT FROM _today THEN
    _daily := _daily_allowance;
  END IF;

  _purchased := _purchased + _amount;

  UPDATE public.user_entitlements
  SET ai_credits = _daily, purchased_credits = _purchased, credits_reset_at = _today
  WHERE user_id = _user_id;

  RETURN _daily + _purchased;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_ai_credit(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_credit(UUID, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.grant_ai_credits(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_ai_credits(UUID, INTEGER, INTEGER) TO service_role;
