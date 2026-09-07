# MetricOps Integration Guide

MetricOps integrations are typed adapters registered in the backend. An adapter receives a tenant-owned connection record, retrieves credentials from the configured secret provider, applies the egress policy, performs a bounded operation, and returns normalized, non-secret results.

The implemented adapters validate PostgreSQL and Prometheus connectivity. MetricOps also accepts authenticated Alertmanager deliveries. The same contract is intended for Grafana, AWS, and additional databases without weakening tenant, secret, audit, or network controls.

## 1. PostgreSQL integration

### Create a least-privilege monitored-database account

Run as the target database administrator and narrow the grants to the schemas MetricOps must inspect:

```sql
CREATE ROLE metricops_monitor LOGIN PASSWORD 'GENERATE_A_UNIQUE_SECRET' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE application_database TO metricops_monitor;
GRANT USAGE ON SCHEMA public TO metricops_monitor;
GRANT SELECT ON pg_catalog.pg_stat_database TO metricops_monitor;
ALTER ROLE metricops_monitor SET statement_timeout = '5s';
ALTER ROLE metricops_monitor SET default_transaction_read_only = on;
```

Do not grant table write privileges, replication, role administration, superuser, or operating-system access. Use a dedicated account per customer environment and rotate it independently.

### Install the credential

Create `secrets/connections/customer-reporting-db.json` on the API host:

```json
{
  "username": "metricops_monitor",
  "password": "REPLACE_WITH_GENERATED_SECRET",
  "ca": "-----BEGIN CERTIFICATE-----\nPRIVATE_CA_IF_REQUIRED\n-----END CERTIFICATE-----\n"
}
```

```bash
chmod 0600 secrets/connections/customer-reporting-db.json
```

The API accepts only `file:customer-reporting-db` as the reference. It rejects path traversal, symbolic links, malformed files, and group/world-readable secret files. The secret value is never stored in the application database or returned by the API.

### Permit the destination

Add the smallest possible network to `CONNECTION_ALLOWED_CIDRS`, or add the exact DNS name to `CONNECTION_ALLOWED_HOSTS`. CIDR policy accepts IPv4 ranges. Exact hostname policy is appropriate for endpoints whose addresses change; enforce the same destination at the host firewall or egress proxy.

Metadata-service addresses, loopback, and every destination outside the allow-list are denied. DNS answers are checked before connecting and PostgreSQL connects to the checked address while retaining the original hostname for TLS verification.

### Register and validate the connection

Obtain an OIDC access token with `connection:write` and `connection:validate`. Use a new UUID idempotency key for each logical create operation:

```bash
curl --fail-with-body https://metricops.example.gov/api/v1/connections \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 8d91f1d4-54ec-4fee-9c2c-7aebf1600375" \
  -d '{
    "name": "Customer reporting database",
    "kind": "postgresql",
    "configuration": {
      "host": "reporting-db.internal.example",
      "port": 5432,
      "database": "application_database",
      "sslMode": "verify-full"
    },
    "secretRef": "file:customer-reporting-db"
  }'
```

Queue validation using the returned opaque connection ID and a new idempotency key:

```bash
curl --fail-with-body -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Idempotency-Key: 97b9df53-8f80-46c3-bfdb-b43f85793cb5" \
  https://metricops.example.gov/api/v1/connections/CONNECTION_UUID/validation-jobs
```

Poll the returned `Location` URL with a token containing `job:read`. Validation enforces certificate verification, bounded connection/query timeouts, retries, and a read-only metadata query. Failed checks return stable codes; server error text is deliberately not exposed.

For retry-safe asynchronous validation, submit `POST /api/v1/connections/{connectionId}/validation-jobs` with an `Idempotency-Key`, then poll the URL in its `Location` response with a token containing `job:read`. Jobs have expiring leases and bounded exponential retries; a worker crash does not permanently strand a job.

## 2. MySQL 8 integration

The current MySQL adapter targets MySQL 8.0 or newer. MariaDB and other protocol-compatible products require separate compatibility testing before production approval.

Create a dedicated account restricted to the MetricOps network source. Give it access only to a purpose-built health view rather than application tables:

```sql
CREATE VIEW application_database.metricops_health
SQL SECURITY DEFINER
AS SELECT 1 AS healthy;

CREATE USER 'metricops_monitor'@'10.40.%'
  IDENTIFIED WITH caching_sha2_password BY 'GENERATE_A_UNIQUE_SECRET'
  REQUIRE SSL
  WITH MAX_USER_CONNECTIONS 2;

GRANT SELECT ON application_database.metricops_health
  TO 'metricops_monitor'@'10.40.%';
```

Do not grant `FILE`, `PROCESS`, `RELOAD`, `SHUTDOWN`, `SUPER`, `SYSTEM_USER`, `CREATE USER`, replication, schema mutation, or access to application tables. Narrow the host portion further when a fixed API/worker address is available. Rotate the password with `ALTER USER` and revoke the account immediately when disconnecting the integration.

Install a mode `0600` credential file such as `secrets/connections/customer-mysql.json`:

```json
{
  "username": "metricops_monitor",
  "password": "REPLACE_WITH_GENERATED_SECRET",
  "ca": "-----BEGIN CERTIFICATE-----\nPRIVATE_CA_IF_REQUIRED\n-----END CERTIFICATE-----\n"
}
```

The server certificate must contain the configured DNS hostname in its subject alternative names. MetricOps resolves and validates the destination against its egress policy, connects to the approved address, and retains the original hostname for TLS identity verification.

```bash
curl --fail-with-body https://metricops.example.gov/api/v1/connections \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 750832f4-f96f-40f1-a7f1-5a5b026aac7e" \
  -d '{
    "name": "Customer MySQL",
    "kind": "mysql",
    "configuration": {
      "host": "mysql.internal.example",
      "port": 3306,
      "database": "application_database",
      "sslMode": "verify_identity"
    },
    "secretRef": "file:customer-mysql"
  }'
```

Queue validation through `/api/v1/connections/{connectionId}/validation-jobs`. The connector requires TLS 1.2 or newer, validates the certificate chain and hostname, disables multi-statement execution and keepalive, applies connection and statement deadlines, starts a read-only transaction, and returns only the database name, bounded server version, and server read-only state.

## 3. Prometheus integration

Prometheus must be reachable over HTTPS through an approved private route, gateway, or protected reverse proxy. Do not expose Prometheus publicly and do not enable anonymous access.

If authentication is required, create a `0600` secret file containing exactly one method:

```json
{ "bearerToken": "REPLACE_WITH_SHORT_LIVED_OR_ROTATED_TOKEN", "ca": "-----BEGIN CERTIFICATE-----\nPRIVATE_CA\n-----END CERTIFICATE-----\n" }
```

or:

```json
{ "username": "metricops_monitor", "password": "REPLACE_WITH_GENERATED_SECRET", "ca": "-----BEGIN CERTIFICATE-----\nPRIVATE_CA\n-----END CERTIFICATE-----\n" }
```

Register the endpoint:

```bash
curl --fail-with-body https://metricops.example.gov/api/v1/connections \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 16740b14-b46a-4294-ae91-e5024d223302" \
  -d '{
    "name": "Customer Prometheus",
    "kind": "prometheus",
    "configuration": {
      "baseUrl": "https://prometheus.internal.example",
      "healthPath": "/-/ready"
    },
    "secretRef": "file:customer-prometheus"
  }'
```

For an upstream protected entirely by mTLS or a network gateway with no HTTP credential, set `secretRef` to `null`. The current adapter performs only a bounded readiness check; arbitrary PromQL proxying is intentionally not exposed yet because query cost, label sensitivity, and authorization require a separate reviewed policy.

### Register an inventory resource

Link a Linux host to its same-tenant Prometheus connection. `monitoringSelector` is the exact `instance` label used by the approved templates:

```bash
curl --fail-with-body https://metricops.example.gov/api/v1/resources \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: bcfb5cac-8742-42cf-895b-f026c5682327" \
  -d '{
    "providerId": "host-001",
    "resourceType": "linux_host",
    "name": "Payments API host",
    "environment": "production",
    "criticality": "critical",
    "dataClassification": "restricted",
    "monitoringConnectionId": "PROMETHEUS_CONNECTION_UUID",
    "monitoringSelector": "payments-01.internal:9100",
    "tags": { "service": "payments", "owner": "platform" },
    "source": "manual"
  }'
```

### Query an approved metric template

```bash
curl --fail-with-body https://metricops.example.gov/api/v1/metrics/query \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceId": "RESOURCE_UUID",
    "queryId": "host.cpu.utilization",
    "start": "2026-09-04T10:00:00Z",
    "end": "2026-09-04T11:00:00Z",
    "stepSeconds": 60
  }'
```

Clients cannot submit PromQL. They select one of `host.up`, `host.cpu.utilization`, or `host.memory.utilization`; MetricOps inserts the stored restricted selector and enforces query range, point, series, sample, response-size, and timeout limits. Results explicitly report `available`, `stale`, or `no_data`.

## 4. Alertmanager webhook integration

Alertmanager webhook deliveries reach a tenant-specific endpoint. MetricOps verifies the exact request bytes with HMAC-SHA256 before parsing JSON, rejects timestamps outside a five-minute window, and stores each nonce once. Critical firing alerts create incidents; resolved alerts resolve their active incidents. Alert and incident rows, event histories, receipts, and audit records are protected by tenant row-level security.

### Install the signing secret

Generate at least 32 random bytes and install the same value in MetricOps and the approved signing relay. Do not put it in Alertmanager YAML, a URL, source control, or a Kubernetes ConfigMap.

```bash
openssl rand -base64 48
```

Create a mode `0600` file such as `secrets/connections/customer-alertmanager.json`:

```json
{ "hmacKey": "REPLACE_WITH_GENERATED_SECRET" }
```

Register the tenant-owned endpoint with a token containing `connection:write`:

```bash
curl --fail-with-body https://metricops.example.gov/api/v1/connections \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 991d9d91-a7f9-4393-8f86-aabddf510ead" \
  -d '{
    "name": "Customer Alertmanager",
    "kind": "alertmanager_webhook",
    "configuration": { "sourceName": "production-alertmanager" },
    "secretRef": "file:customer-alertmanager"
  }'
```

The destination is:

```text
POST https://metricops.example.gov/api/v1/webhooks/alertmanager/CUSTOMER_UUID/CONNECTION_UUID
```

### Required signing relay

Native Prometheus Alertmanager does not generate per-request HMAC timestamp, nonce, and signature headers. Place a small, customer-controlled signing relay beside Alertmanager or use an approved gateway that can perform equivalent dynamic request signing. Alertmanager authenticates to that relay over a private route; the relay forwards the unchanged JSON body over HTTPS with:

```text
X-MetricOps-Timestamp: UNIX_SECONDS
X-MetricOps-Nonce: RANDOM_UUID
X-MetricOps-Signature: v1=LOWERCASE_HEX_HMAC_SHA256
```

The signing input is the UTF-8 byte sequence `timestamp + "." + nonce + "." + raw_body`. Never parse and reserialize the body after computing the signature. Configure the relay with bounded timeouts, no response-body logging, a 256 KiB request limit, and retries that reuse the same nonce. A retry of an accepted request receives `409 WEBHOOK_REPLAYED` and must be treated as successfully deduplicated.

Allow only the relay or gateway source range at the reverse proxy. Keep both systems synchronized with NTP. Rotate by creating a new connection and secret, changing the relay destination, validating delivery, then disabling and removing the old connection secret.

Alertmanager labels may include `metricops_resource_id` with a MetricOps resource UUID. MetricOps links it only when the resource belongs to the same customer. Unrecognized or cross-tenant identifiers are ignored. Severity is normalized to `critical`, `warning`, or `info`; only critical firing alerts automatically create incidents.

Operators need `alert:read` for `GET /api/v1/alerts`, `incident:read` for `GET /api/v1/incidents`, and `incident:write` for acknowledge/resolve operations. Both mutations require the current `version` and a unique `Idempotency-Key` UUID.

The worker calls the protected retention functions hourly. Replay receipts are retained for 24 hours; the function permits only ten minutes through thirty days. The timestamp window still prevents a captured delivery from being accepted after its receipt is pruned. The same maintenance cycle removes expired idempotency/session records and terminal jobs older than 30 days.

## 5. AWS AssumeRole discovery

MetricOps discovers EC2 instances, EBS volumes, RDS instances, and application/network load balancers through temporary AWS STS credentials. It never accepts or stores an AWS access-key ID or secret access key. The API and worker must obtain their source identity from the compute platform: an EC2 instance profile, ECS task role, or Kubernetes service-account web identity.

### Create the customer discovery role

Create a dedicated role in the customer AWS account. Its trust policy must name the exact MetricOps workload role and require a unique external ID generated for that customer:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::METRICOPS_ACCOUNT_ID:role/MetricOpsWorkload" },
    "Action": ["sts:AssumeRole", "sts:SetSourceIdentity"],
    "Condition": { "StringEquals": { "sts:ExternalId": "CUSTOMER_UNIQUE_EXTERNAL_ID" } }
  }]
}
```

Attach only the read operations enabled for the connection:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ec2:DescribeInstances",
      "ec2:DescribeVolumes",
      "rds:DescribeDBInstances",
      "elasticloadbalancing:DescribeLoadBalancers"
    ],
    "Resource": "*"
  }]
}
```

AWS requires `Resource: "*"` for these Describe operations. Do not add mutation, IAM, Organizations, billing, S3 object, Secrets Manager, Systems Manager session, KMS decrypt, or CloudTrail permissions. Apply an organization SCP and permissions boundary where available. The MetricOps workload role itself should have only `sts:AssumeRole` for the approved customer-role ARN pattern.

### Register and run discovery

```bash
curl --fail-with-body https://metricops.example.gov/api/v1/connections \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 68bd7f84-653b-494b-909c-e79b44073952" \
  -d '{
    "name": "Customer production AWS",
    "kind": "aws_assume_role",
    "configuration": {
      "roleArn": "arn:aws:iam::123456789012:role/MetricOpsReadOnly",
      "externalId": "CUSTOMER_UNIQUE_EXTERNAL_ID",
      "regions": ["us-east-1", "us-west-2"],
      "resourceTypes": ["aws_ec2", "aws_ebs", "aws_rds", "aws_load_balancer"],
      "maxResources": 1000
    },
    "secretRef": null
  }'
```

Validate STS access with a normal connection-validation job using `connection:validate`. Queue inventory discovery with a token containing `resource:discover`:

```bash
curl --fail-with-body -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Idempotency-Key: e5d39ea8-b0e0-41a4-89c5-ad7e449c1700" \
  https://metricops.example.gov/api/v1/connections/CONNECTION_UUID/discovery-jobs
```

Poll the returned `Location` with `job:read`. Discovery is durable and retry-safe, API calls use bounded timeouts and SDK retries, and the configured aggregate resource cap is enforced before database changes. A successful scan upserts the discovered inventory atomically and marks previously seen-but-now-absent resources as `missing`. A partial or failed AWS scan leaves the last complete inventory unchanged.

AWS API hostnames are derived only from validated region identifiers; arbitrary SDK endpoint URLs are not accepted. Permit STS, EC2, RDS, and Elastic Load Balancing endpoints for the approved regions through VPC endpoints or the controlled egress layer. Alert on repeated `AWS_ROLE_UNAVAILABLE` or `JOB_EXECUTION_FAILED` results. Rotate an external ID by creating a replacement AWS role/connection and validating it before disabling the old connection.

## 6. Adding another integration

1. Add a new literal to `ConnectionKind` and a non-secret configuration type in `src/connections/types.ts`.
2. Implement the `Connector` interface. Every operation must be typed, bounded by timeout, safe to retry where applicable, and return normalized results without upstream secrets or raw internal errors.
3. Retrieve credentials through a secret-provider interface. Do not add password, token, key, certificate private key, or connection URI fields to API responses or logs.
4. Route every user-configurable host through `EgressPolicy`; do not resolve or connect to an unapproved destination directly.
5. Use the authenticated principal's `customerId`. Never accept tenant ownership from an integration payload.
6. Register the connector explicitly in `src/main.ts`. Unregistered connection kinds fail closed.
7. Add schema validation, permission checks, audit events, idempotency for retryable mutations, and tenant-negative tests.
8. Add contract tests against a disposable upstream system, including timeout, TLS failure, revoked credentials, partial privileges, pagination, rate limiting, and malformed responses.
9. Document least-privilege upstream permissions, credential rotation, revocation, network flows, expected API quotas, and failure behavior.
10. Complete security review before enabling the adapter in production.

## 7. Integration invariants

- No arbitrary shell commands, SQL from end users, or unrestricted proxy endpoints.
- No permanent cloud access keys when temporary workload identity or role assumption is available.
- No plaintext secrets in PostgreSQL, API responses, logs, audit details, support bundles, or source control.
- No cross-customer caching, job execution, or identifier lookup.
- No unbounded pagination, response size, concurrency, retry, or query duration.
- No public exposure of a private monitoring or management endpoint merely to make integration easier.
- Every administrative or state-changing integration operation must produce an audit event in the same authoritative transaction as its state change.
