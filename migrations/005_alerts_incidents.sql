BEGIN;

CREATE TABLE webhook_receipts (
  customer_id uuid NOT NULL REFERENCES customers(id),
  connection_id uuid NOT NULL,
  nonce uuid NOT NULL,
  signature_timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, connection_id, nonce),
  FOREIGN KEY (customer_id, connection_id) REFERENCES connections(customer_id, id)
);

CREATE TABLE alert_instances (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  connection_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[A-Fa-f0-9]{1,64}$'),
  status text NOT NULL CHECK (status IN ('firing', 'resolved')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 2000),
  labels jsonb NOT NULL,
  resource_id uuid REFERENCES resources(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  last_received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, connection_id, fingerprint),
  FOREIGN KEY (customer_id, connection_id) REFERENCES connections(customer_id, id)
);

CREATE TABLE alert_events (
  sequence bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  alert_instance_id uuid NOT NULL REFERENCES alert_instances(id),
  event_type text NOT NULL CHECK (event_type IN ('firing', 'resolved')),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE incidents (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  alert_instance_id uuid NOT NULL REFERENCES alert_instances(id),
  resource_id uuid REFERENCES resources(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  severity text NOT NULL CHECK (severity IN ('warning', 'critical')),
  status text NOT NULL CHECK (status IN ('open', 'acknowledged', 'investigating', 'mitigating', 'monitoring', 'resolved', 'closed')),
  assignee text,
  resolution text CHECK (resolution IS NULL OR length(resolution) <= 4000),
  detected_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX incidents_one_active_per_alert_idx ON incidents (customer_id, alert_instance_id)
WHERE status NOT IN ('resolved', 'closed');

CREATE TABLE incident_events (
  sequence bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  incident_id uuid NOT NULL REFERENCES incidents(id),
  actor_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'acknowledged', 'resolved')),
  details jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alert_instances_customer_status_idx ON alert_instances (customer_id, status, updated_at DESC);
CREATE INDEX alert_events_customer_sequence_idx ON alert_events (customer_id, sequence DESC);
CREATE INDEX incidents_customer_status_idx ON incidents (customer_id, status, updated_at DESC);
CREATE INDEX incident_events_customer_sequence_idx ON incident_events (customer_id, sequence DESC);
CREATE INDEX webhook_receipts_received_idx ON webhook_receipts (received_at);

ALTER TABLE webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE alert_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events FORCE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_events FORCE ROW LEVEL SECURITY;

CREATE POLICY webhook_receipts_tenant_isolation ON webhook_receipts USING (customer_id=nullif(current_setting('app.current_customer_id',true),'')::uuid) WITH CHECK (customer_id=nullif(current_setting('app.current_customer_id',true),'')::uuid);
CREATE POLICY alert_instances_tenant_isolation ON alert_instances USING (customer_id=nullif(current_setting('app.current_customer_id',true),'')::uuid) WITH CHECK (customer_id=nullif(current_setting('app.current_customer_id',true),'')::uuid);
CREATE POLICY alert_events_tenant_isolation ON alert_events USING (customer_id=nullif(current_setting('app.current_customer_id',true),'')::uuid) WITH CHECK (customer_id=nullif(current_setting('app.current_customer_id',true),'')::uuid);
CREATE POLICY incidents_tenant_isolation ON incidents USING (customer_id=nullif(current_setting('app.current_customer_id',true),'')::uuid) WITH CHECK (customer_id=nullif(current_setting('app.current_customer_id',true),'')::uuid);
CREATE POLICY incident_events_tenant_isolation ON incident_events USING (customer_id=nullif(current_setting('app.current_customer_id',true),'')::uuid) WITH CHECK (customer_id=nullif(current_setting('app.current_customer_id',true),'')::uuid);

CREATE TRIGGER alert_events_immutable BEFORE UPDATE OR DELETE ON alert_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER incident_events_immutable BEFORE UPDATE OR DELETE ON incident_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

GRANT SELECT, INSERT ON webhook_receipts TO metricops_app;
GRANT SELECT, INSERT, UPDATE ON alert_instances TO metricops_app;
GRANT SELECT, INSERT ON alert_events TO metricops_app;
GRANT SELECT, INSERT, UPDATE ON incidents TO metricops_app;
GRANT SELECT, INSERT ON incident_events TO metricops_app;
GRANT USAGE, SELECT ON SEQUENCE alert_events_sequence_seq, incident_events_sequence_seq TO metricops_app;

COMMIT;
