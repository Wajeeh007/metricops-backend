BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind text NOT NULL,
  configuration jsonb NOT NULL,
  secret_ref text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'healthy', 'unhealthy', 'disabled')),
  last_validated_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, name)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  customer_id uuid NOT NULL REFERENCES customers(id),
  operation text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (customer_id, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  sequence bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  request_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  details jsonb NOT NULL,
  previous_hash text,
  chain_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS revoked_sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  customer_id uuid NOT NULL REFERENCES customers(id),
  subject_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connections_customer_created_idx ON connections (customer_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS audit_events_customer_sequence_idx ON audit_events (customer_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_records (expires_at);
CREATE INDEX IF NOT EXISTS revoked_sessions_expiry_idx ON revoked_sessions (expires_at);

ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connections_tenant_isolation ON connections;
CREATE POLICY connections_tenant_isolation ON connections
  USING (customer_id = nullif(current_setting('app.current_customer_id', true), '')::uuid)
  WITH CHECK (customer_id = nullif(current_setting('app.current_customer_id', true), '')::uuid);

DROP POLICY IF EXISTS idempotency_tenant_isolation ON idempotency_records;
CREATE POLICY idempotency_tenant_isolation ON idempotency_records
  USING (customer_id = nullif(current_setting('app.current_customer_id', true), '')::uuid)
  WITH CHECK (customer_id = nullif(current_setting('app.current_customer_id', true), '')::uuid);

DROP POLICY IF EXISTS audit_events_tenant_isolation ON audit_events;
CREATE POLICY audit_events_tenant_isolation ON audit_events
  USING (customer_id = nullif(current_setting('app.current_customer_id', true), '')::uuid)
  WITH CHECK (customer_id = nullif(current_setting('app.current_customer_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

GRANT USAGE ON SCHEMA public TO metricops_app;
GRANT INSERT ON customers TO metricops_app;
GRANT SELECT, INSERT, UPDATE ON connections TO metricops_app;
GRANT SELECT, INSERT ON idempotency_records TO metricops_app;
GRANT SELECT, INSERT ON audit_events TO metricops_app;
GRANT SELECT, INSERT ON revoked_sessions TO metricops_app;
GRANT USAGE, SELECT ON SEQUENCE audit_events_sequence_seq TO metricops_app;

COMMIT;
