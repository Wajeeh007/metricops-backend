BEGIN;

ALTER TABLE resources DROP CONSTRAINT resources_last_discovery_job_id_fkey;
ALTER TABLE resources
  ADD CONSTRAINT resources_last_discovery_job_id_fkey
  FOREIGN KEY (last_discovery_job_id) REFERENCES jobs(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION prune_metricops_operational_records(p_job_retention interval DEFAULT interval '30 days')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  idempotency_count bigint;
  session_count bigint;
  job_count bigint;
BEGIN
  IF p_job_retention < interval '1 day' OR p_job_retention > interval '365 days' THEN
    RAISE EXCEPTION 'job retention must be between 1 day and 365 days';
  END IF;

  DELETE FROM public.idempotency_records WHERE expires_at < clock_timestamp();
  GET DIAGNOSTICS idempotency_count = ROW_COUNT;

  DELETE FROM public.revoked_sessions WHERE expires_at < clock_timestamp();
  GET DIAGNOSTICS session_count = ROW_COUNT;

  DELETE FROM public.jobs
  WHERE status IN ('succeeded', 'failed', 'cancelled')
    AND completed_at < clock_timestamp() - p_job_retention;
  GET DIAGNOSTICS job_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'idempotencyRecords', idempotency_count,
    'revokedSessions', session_count,
    'jobs', job_count
  );
END;
$$;

REVOKE ALL ON FUNCTION prune_metricops_operational_records(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_metricops_operational_records(interval) TO metricops_worker;

COMMIT;
