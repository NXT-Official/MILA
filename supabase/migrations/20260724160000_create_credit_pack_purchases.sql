-- ============================================================================
-- credit_pack_purchases — idempotency ledger for one-time credit-pack
-- purchases, plus grant_ai_credits() to add purchased credits on top of a
-- user's current balance.
--
-- paddle_transaction_id is UNIQUE: Paddle can retry webhook delivery for the
-- same transaction. The webhook handler upserts with
-- { onConflict: "paddle_transaction_id", ignoreDuplicates: true }, so a
-- retried delivery is a no-op insert (no error, no second grant) rather than
-- needing an application-level dedup cache.
--
-- No client access at all: this table is the webhook's internal bookkeeping,
-- written only by the service role. Not surfaced in any admin UI in this
-- change — out of scope per the design spec.
-- ============================================================================

CREATE TABLE public.credit_pack_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credit_pack_id UUID NOT NULL REFERENCES public.credit_packs(id),
  paddle_transaction_id TEXT NOT NULL UNIQUE,
  credits_granted INTEGER NOT NULL CHECK (credits_granted > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_pack_purchases ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_credit_pack_purchases_user ON public.credit_pack_purchases (user_id);

REVOKE ALL ON public.credit_pack_purchases FROM anon, authenticated;

-- Mirrors consume_ai_credit's row-lock and day-reset logic exactly, so a
-- purchase made before the user's first credit-consuming action of the day
-- doesn't stack on top of a stale (yesterday's) balance.
CREATE FUNCTION public.grant_ai_credits(
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
  _current_credits INTEGER;
  _current_reset_at DATE;
  _post_reset_credits INTEGER;
  _final_credits INTEGER;
BEGIN
  IF _daily_allowance IS NULL OR _daily_allowance < 0 THEN
    RAISE EXCEPTION 'invalid_daily_allowance';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

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

  UPDATE public.user_entitlements
  SET ai_credits = _post_reset_credits + _amount, credits_reset_at = _today
  WHERE user_id = _user_id
  RETURNING ai_credits INTO _final_credits;

  RETURN _final_credits;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_ai_credits(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_ai_credits(UUID, INTEGER, INTEGER) TO service_role;
