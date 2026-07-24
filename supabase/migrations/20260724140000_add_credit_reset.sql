-- ============================================================================
-- Daily AI-credit reset.
--
-- user_entitlements.ai_credits previously only changed via the Paddle webhook
-- refilling it once per billing period (src/lib/paddle-webhook.server.ts).
-- That refill is now largely superseded by the daily lazy-reset below: the
-- next consume_ai_credit() call after any webhook-driven change will see
-- today's date doesn't match credits_reset_at (untouched by the webhook) and
-- overwrite ai_credits with the plan's daily allowance anyway. This is
-- harmless — no double-grant, no crash — just dead-but-correct overlap left
-- as-is rather than touching webhook logic again for this change.
--
-- credits_reset_at starts NULL for every existing row (no backfill needed):
-- NULL IS DISTINCT FROM CURRENT_DATE is true, so the first call for any user
-- naturally resets them to their plan's daily allowance.
-- ============================================================================

ALTER TABLE public.user_entitlements
  ADD COLUMN credits_reset_at DATE;

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
  _current_credits INTEGER;
  _current_reset_at DATE;
  _post_reset_credits INTEGER;
  _final_credits INTEGER;
BEGIN
  IF _daily_allowance IS NULL OR _daily_allowance < 0 THEN
    RAISE EXCEPTION 'invalid_daily_allowance';
  END IF;

  -- Row lock: concurrent calls for the same user serialize here, so two
  -- requests racing can never both observe pre-reset/pre-decrement credits.
  -- Same atomicity guarantee check_rate_limit gets from its single-statement
  -- upsert, achieved here via an explicit lock instead.
  SELECT ai_credits, credits_reset_at INTO _current_credits, _current_reset_at
  FROM public.user_entitlements
  WHERE user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'entitlements_not_found';
  END IF;

  _post_reset_credits := CASE
    WHEN _current_reset_at IS DISTINCT FROM _today THEN _daily_allowance
    ELSE _current_credits
  END;

  IF _post_reset_credits <= 0 THEN
    UPDATE public.user_entitlements
    SET ai_credits = 0, credits_reset_at = _today
    WHERE user_id = _user_id;
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  UPDATE public.user_entitlements
  SET ai_credits = _post_reset_credits - 1, credits_reset_at = _today
  WHERE user_id = _user_id
  RETURNING ai_credits INTO _final_credits;

  RETURN QUERY SELECT true, _final_credits;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_ai_credit(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_credit(UUID, INTEGER) TO service_role;
