-- P2b: a refunded generation job keeps the result it was refunded for. ADDITIVE ONLY.
-- Not applied by agents. Apply after 20261007143000_generation_jobs.sql (needs
-- public.generation_jobs and public.refund_generation_job_credit). Independent of
-- 20261007170000 and of Wave D's 20261008090000.
-- Before it is applied: the server calls fail_generation_job instead (the refund is
-- unchanged; only the refunded result is not kept on the row).
CREATE OR REPLACE FUNCTION public.fail_generation_job_with_result(
  p_job_id UUID, p_error_code TEXT, p_refund BOOLEAN, p_result JSONB)
RETURNS TABLE (outcome TEXT, job public.generation_jobs)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_job public.generation_jobs%ROWTYPE;
  v_outcome TEXT := 'not_running';
BEGIN
  IF p_result IS NOT NULL AND (jsonb_typeof(p_result) <> 'object'
       OR octet_length(p_result::text) > 65536) THEN
    RAISE EXCEPTION 'invalid_result';
  END IF;
  SELECT j.* INTO v_job FROM public.generation_jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'generation_job_not_found'; END IF;
  IF v_job.status = 'running' THEN
    UPDATE public.generation_jobs AS j
       SET status = 'failed',
           error_code = coalesce(nullif(left(btrim(p_error_code), 200), ''), 'unknown'),
           result = p_result,
           completed_at = now()
     WHERE j.id = p_job_id AND j.status = 'running';
    IF FOUND THEN v_outcome := 'failed'; END IF;
  END IF;
  -- Same exactly-once guard as fail_generation_job: only a failed, still-charged job.
  IF coalesce(p_refund, FALSE) THEN
    PERFORM public.refund_generation_job_credit(p_job_id);
  END IF;
  SELECT j.* INTO v_job FROM public.generation_jobs AS j WHERE j.id = p_job_id;
  RETURN QUERY SELECT v_outcome, v_job;
END $$;

COMMENT ON FUNCTION public.fail_generation_job_with_result(UUID, TEXT, BOOLEAN, JSONB) IS
  'fail_generation_job that also stores the result the job was failed (and refunded) with, only on the running -> failed transition. A finished row is never overwritten.';
REVOKE EXECUTE ON FUNCTION public.fail_generation_job_with_result(UUID, TEXT, BOOLEAN, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_generation_job_with_result(UUID, TEXT, BOOLEAN, JSONB)
  TO service_role;
