BEGIN;

ALTER TABLE connections ADD CONSTRAINT connections_customer_id_id_unique UNIQUE (customer_id, id);

CREATE TABLE resources (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  provider_id text NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 300),
  resource_type text NOT NULL CHECK (resource_type IN ('linux_host', 'application_endpoint', 'database_instance', 'aws_ec2', 'aws_ebs', 'aws_rds', 'aws_load_balancer')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  environment text NOT NULL CHECK (length(environment) BETWEEN 1 AND 100),
  criticality text NOT NULL CHECK (criticality IN ('low', 'medium', 'high', 'critical')),
  data_classification text NOT NULL CHECK (data_classification IN ('public', 'internal', 'confidential', 'restricted')),
  monitoring_connection_id uuid,
  monitoring_selector text CHECK (monitoring_selector IS NULL OR length(monitoring_selector) BETWEEN 1 AND 253),
  tags jsonb NOT NULL DEFAULT '{}',
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 100),
  last_discovered_at timestamptz,
  last_telemetry_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, source, provider_id),
  FOREIGN KEY (customer_id, monitoring_connection_id) REFERENCES connections(customer_id, id),
  CHECK ((monitoring_connection_id IS NULL) = (monitoring_selector IS NULL))
);

CREATE INDEX resources_customer_created_idx ON resources (customer_id, created_at DESC, id);
CREATE INDEX resources_customer_type_idx ON resources (customer_id, resource_type);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources FORCE ROW LEVEL SECURITY;
CREATE POLICY resources_tenant_isolation ON resources
  USING (customer_id = nullif(current_setting('app.current_customer_id', true), '')::uuid)
  WITH CHECK (customer_id = nullif(current_setting('app.current_customer_id', true), '')::uuid);

GRANT SELECT, INSERT ON resources TO metricops_app;

COMMIT;
