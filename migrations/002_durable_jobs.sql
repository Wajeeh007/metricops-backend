BEGIN;

ALTER TABLE connections ALTER COLUMN secret_ref DROP NOT NULL;

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  kind text NOT NULL CHECK (kind IN ('connection.validate')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  payload jsonb NOT NULL,
  result jsonb,
  error_code text,
  idempotency_key uuid NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (customer_id, kind, idempotency_key)
);

CREATE INDEX jobs_claim_idx ON jobs (available_at, created_at) WHERE status IN ('queued', 'running');
CREATE INDEX jobs_customer_created_idx ON jobs (customer_id, created_at DESC, id);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY jobs_tenant_isolation ON jobs
  USING (customer_id = nullif(current_setting('app.current_customer_id', true), '')::uuid)
  WITH CHECK (customer_id = nullif(current_setting('app.current_customer_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION claim_metricops_jobs(p_worker uuid, p_limit integer, p_lease_seconds integer)
RETURNS SETOF jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.jobs
    WHERE available_at <= clock_timestamp()
      AND (status = 'queued' OR (status = 'running' AND lease_expires_at < clock_timestamp()))
    ORDER BY available_at, created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 20)
  )
  UPDATE public.jobs AS job
  SET status = 'running',
      attempts = attempts + 1,
      lease_owner = p_worker,
      lease_expires_at = clock_timestamp() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 5), 300)),
      updated_at = clock_timestamp()
  FROM candidates
  WHERE job.id = candidates.id
  RETURNING job.*;
$$;

CREATE OR REPLACE FUNCTION finish_metricops_job(
  p_worker uuid,
  p_job uuid,
  p_succeeded boolean,
  p_result jsonb,
  p_error_code text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.jobs
  SET status = CASE
        WHEN p_succeeded THEN 'succeeded'
        WHEN attempts >= max_attempts THEN 'failed'
        ELSE 'queued'
      END,
      result = CASE WHEN p_succeeded THEN p_result ELSE NULL END,
      error_code = CASE WHEN p_succeeded THEN NULL ELSE left(coalesce(p_error_code, 'JOB_FAILED'), 100) END,
      available_at = CASE
        WHEN p_succeeded OR attempts >= max_attempts THEN available_at
        ELSE clock_timestamp() + make_interval(secs => LEAST(300, (2 ^ attempts)::integer))
      END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = CASE WHEN p_succeeded OR attempts >= max_attempts THEN clock_timestamp() ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE id = p_job AND status = 'running' AND lease_owner = p_worker;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION claim_metricops_jobs(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION finish_metricops_job(uuid, uuid, boolean, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_metricops_jobs(uuid, integer, integer) TO metricops_worker;
GRANT EXECUTE ON FUNCTION finish_metricops_job(uuid, uuid, boolean, jsonb, text) TO metricops_worker;

GRANT SELECT, INSERT ON jobs TO metricops_app;
GRANT SELECT, UPDATE ON connections TO metricops_worker;
GRANT SELECT, INSERT ON audit_events TO metricops_worker;
GRANT USAGE, SELECT ON SEQUENCE audit_events_sequence_seq TO metricops_worker;

COMMIT;
