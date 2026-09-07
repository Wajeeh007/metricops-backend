BEGIN;

ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('connection.validate', 'aws.discover'));

ALTER TABLE resources
  ADD COLUMN discovery_state text NOT NULL DEFAULT 'active' CHECK (discovery_state IN ('active', 'missing')),
  ADD COLUMN last_discovery_job_id uuid REFERENCES jobs(id);

CREATE INDEX resources_customer_source_discovery_idx
  ON resources (customer_id, source, discovery_state, updated_at DESC);

GRANT SELECT, INSERT, UPDATE ON resources TO metricops_worker;

COMMIT;
