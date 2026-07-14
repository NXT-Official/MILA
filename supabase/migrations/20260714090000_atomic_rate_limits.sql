-- ============================================================================
-- Atomic, durable rate limiting shared across every app instance.
--
-- The previous limiter (src/lib/rate-limit.server.ts) is an in-memory Map:
-- it resets on redeploy, is not shared across horizontally-scaled instances,
-- and cannot be the primary control for AI-cost or anonymous-abuse
-- endpoints. This table + function pair gives server code a single atomic
-- "check and consume" primitive backed by Postgres.
--
-- Not reachable by clients: no anon/authenticated grants on the table or the
-- function. Only the service-role server code (src/lib/rate-limit.server.ts
-- consumeRateLimit) calls it, keyed by a server-derived string (never raw
-- client input) such as `ai:generateDailyLook:<userId>`.
-- ============================================================================

CREATE TABLE public.rate_limit_buckets (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- No policies: with no grants at all, RLS denies everyone by default anyway;
-- this is belt-and-suspenders in case grants are ever loosened by mistake.
REVOKE ALL ON public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rate_limit_buckets TO service_role;

-- Rows persist indefinitely (one per limiter key). A periodic cleanup job
-- (pg_cron or similar) can prune rows older than the longest window in use;
-- not required for correctness since the key set is bounded by userId/IP.
CREATE INDEX rate_limit_buckets_window_start_idx ON public.rate_limit_buckets (window_start);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _key TEXT,
  _limit INTEGER,
  _window_seconds INTEGER
)
RETURNS TABLE(allowed BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _now TIMESTAMPTZ := clock_timestamp();
  _final_window_start TIMESTAMPTZ;
  _final_count INTEGER;
BEGIN
  IF _key IS NULL OR length(_key) = 0 THEN
    RAISE EXCEPTION 'invalid_rate_limit_key';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _window_seconds IS NULL OR _window_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid_rate_limit_params';
  END IF;

  -- Single-statement upsert: Postgres serializes concurrent INSERTs that
  -- conflict on the same key (one waits for the other's row lock), so two
  -- requests racing on the same key can never both observe count <= limit
  -- when only one slot remains. This is what makes the check atomic.
  INSERT INTO public.rate_limit_buckets AS rl (key, window_start, count)
  VALUES (_key, _now, 1)
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE
      WHEN rl.window_start <= _now - make_interval(secs => _window_seconds) THEN _now
      ELSE rl.window_start
    END,
    count = CASE
      WHEN rl.window_start <= _now - make_interval(secs => _window_seconds) THEN 1
      ELSE rl.count + 1
    END
  RETURNING window_start, count INTO _final_window_start, _final_count;

  IF _final_count > _limit THEN
    RETURN QUERY SELECT
      false,
      GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (_final_window_start + make_interval(secs => _window_seconds) - _now)))
      )::int;
  ELSE
    RETURN QUERY SELECT true, 0;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
