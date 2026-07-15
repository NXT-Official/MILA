ALTER TABLE public.rate_limit_buckets
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

DROP FUNCTION IF EXISTS public.check_rate_limit(TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _key TEXT, _limit INTEGER, _window_seconds INTEGER, _cost INTEGER DEFAULT 1
)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, reset_at TIMESTAMPTZ, retry_after_seconds INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  _now TIMESTAMPTZ := clock_timestamp();
  _window_start TIMESTAMPTZ;
  _count INTEGER;
BEGIN
  IF _key IS NULL OR length(_key) = 0 OR length(_key) > 512 OR _limit <= 0 OR _window_seconds <= 0 OR _cost <= 0 THEN
    RAISE EXCEPTION 'invalid_rate_limit_params';
  END IF;
  INSERT INTO public.rate_limit_buckets AS rl (key, window_start, count, expires_at)
  VALUES (_key, _now, _cost, _now + make_interval(secs => _window_seconds))
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE WHEN rl.window_start <= _now - make_interval(secs => _window_seconds) THEN _now ELSE rl.window_start END,
    count = CASE WHEN rl.window_start <= _now - make_interval(secs => _window_seconds) THEN _cost ELSE rl.count + _cost END,
    expires_at = CASE WHEN rl.window_start <= _now - make_interval(secs => _window_seconds) THEN _now + make_interval(secs => _window_seconds) ELSE rl.expires_at END
  RETURNING window_start, count INTO _window_start, _count;
  RETURN QUERY SELECT _count <= _limit, GREATEST(0, _limit - _count),
    _window_start + make_interval(secs => _window_seconds),
    CASE WHEN _count > _limit THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_window_start + make_interval(secs => _window_seconds) - _now)))::int) ELSE 0 END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER, INTEGER) TO service_role;

UPDATE storage.buckets SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id IN ('outfits', 'posts');
