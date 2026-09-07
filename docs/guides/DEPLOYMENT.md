# MetricOps Deployment Guide

This guide deploys the current Node.js/Express control-plane API and its PostgreSQL application database. It is suitable for a controlled pilot. Production acceptance still requires the security, backup, recovery, monitoring, and penetration-testing gates listed below.

## 1. Security model

- The API binds to loopback in the supplied Compose configuration. Publish it only through an approved TLS reverse proxy or load balancer.
- PostgreSQL is attached only to an internal container network and has no host port.
- API authentication uses externally issued OIDC access tokens. The API accepts only `RS256`, `PS256`, or `ES256` signatures and validates issuer, audience, expiry, token ID, and customer context.
- Customer-owned database operations execute inside tenant-scoped transactions. PostgreSQL row-level security provides a second isolation boundary.
- Connection credentials are mounted as read-only files and are never returned by the API.
- External connection targets must be explicitly allowed by CIDR or exact hostname.
- Audit records are append-only and HMAC chained per customer. Protect and back up the audit HMAC key separately from the database.

## 2. Prerequisites

- Linux host with Docker Engine 27+ and Compose v2.
- Approved DNS names and TLS certificates.
- An OIDC provider with MFA required for privileged roles.
- Network routes from the API host to approved monitored databases.
- Encrypted persistent storage for PostgreSQL and encrypted backup storage.
- Accurate NTP time synchronization.

Do not expose port 5432, monitored databases, Prometheus, exporters, or management endpoints to the public internet.

## 3. Prepare deployment secrets

From the repository root:

```bash
install -d -m 0700 secrets/platform secrets/connections
openssl rand -base64 36 > secrets/platform/postgres_password
openssl rand -base64 36 > secrets/platform/postgres_app_password
openssl rand -base64 36 > secrets/platform/postgres_worker_password
openssl rand -base64 48 > secrets/platform/audit_hmac_key
openssl rand -base64 48 > secrets/platform/metrics_bearer_token
chmod 0600 secrets/platform/*
```

Create `secrets/platform/database_url` using `postgres_app_password`, `secrets/platform/worker_database_url` using `postgres_worker_password`, and `secrets/platform/migration_database_url` using the separate `postgres_password`. Percent-encode reserved URL characters in each password:

```text
postgres://metricops_app:PERCENT_ENCODED_APP_PASSWORD@database:5432/metricops
postgres://metricops_worker:PERCENT_ENCODED_WORKER_PASSWORD@database:5432/metricops
postgres://metricops_admin:PERCENT_ENCODED_ADMIN_PASSWORD@database:5432/metricops
```

Provision a server certificate whose subject alternative name contains `DNS:database`. For a pilot, it may be signed by a dedicated private CA; for production, use the organization's approved internal PKI. Install only these files on the host:

```text
secrets/platform/postgres_ca.crt
secrets/platform/postgres_server.crt
secrets/platform/postgres_server.key
```

The CA private key must remain offline or in the approved PKI and must not be placed in this repository or on the application host. The supplied Compose service copies the PostgreSQL private key with owner-only permissions before starting the database with TLS 1.2 or newer.

Set file permissions:

```bash
chmod 0600 secrets/platform/database_url secrets/platform/worker_database_url secrets/platform/migration_database_url secrets/platform/postgres_server.key
chmod 0644 secrets/platform/postgres_ca.crt secrets/platform/postgres_server.crt
```

Never commit the `secrets/` directory. The repository ignores it by default.

## 4. Configure OIDC and network policy

Create a deployment-only `.env` file:

```dotenv
OIDC_ISSUER=https://identity.example.gov/realms/metricops
OIDC_AUDIENCE=metricops-api
OIDC_JWKS_URI=https://identity.example.gov/realms/metricops/protocol/openid-connect/certs
OIDC_MAX_TOKEN_AGE_SECONDS=900
CORS_ORIGINS=https://metricops.example.gov
CONNECTION_ALLOWED_CIDRS=10.40.0.0/16
CONNECTION_ALLOWED_HOSTS=database.partner.example
```

Map identity-provider claims as follows:

- `sub`: immutable user identifier.
- `jti`: unique session/token identifier.
- `customer_id`: opaque UUID for the active customer.
- `permissions`: array containing only approved MetricOps permissions.

Current permissions are `platform:admin`, `connection:read`, `connection:write`, `connection:validate`, `job:read`, `resource:read`, `resource:write`, `resource:discover`, `metrics:read`, `alert:read`, `incident:read`, `incident:write`, `report:read`, and `audit:read`. Keep access tokens short-lived and enforce MFA at the identity provider for privileged users.

`platform:admin` is deliberately not a wildcard permission. A token containing `platform:admin` together with any customer permission is rejected, preserving the boundary between platform administration and customer infrastructure access.

## 5. Build, migrate, and start

```bash
docker compose build --pull
docker compose --profile tools run --rm migrate
docker compose up -d database api worker
docker compose ps
curl --fail http://127.0.0.1:8080/health/ready
```

Run migrations as a controlled deployment step before starting a new API version. Never run two migration jobs concurrently; the migration runner also uses a PostgreSQL advisory lock.

The API connects as `metricops_app` and the background worker as `metricops_worker`; both are non-superuser roles with `NOBYPASSRLS`. Only the worker role can call the narrowly scoped job lease/completion functions. Only the one-shot migration service receives the administrator connection. Never give the API or worker the migration URL or PostgreSQL superuser credentials.

The runtime roles are created only when the supplied PostgreSQL volume is initialized for the first time. If attaching an existing database, have its administrator create equivalent `metricops_app` and `metricops_worker` roles before migrations; do not rerun bootstrap scripts blindly against an existing production cluster.

### AWS workload identity

For AWS discovery, run the API and worker with a workload identity, never an IAM user. Supported deployment patterns are an EC2 instance profile, ECS task role, or Kubernetes service account with OIDC web identity. In production MetricOps refuses to start when `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `AWS_PROFILE` is present. Restrict the source workload role to `sts:AssumeRole` on reviewed customer discovery roles and monitor CloudTrail for unexpected assumptions.

The worker needs outbound HTTPS only to the STS and enabled service endpoints for configured regions. Prefer interface VPC endpoints. If internet egress is required, route it through the controlled proxy/firewall and deny arbitrary destinations. No inbound AWS connectivity is required.

## 6. TLS reverse proxy

Terminate TLS 1.2 or newer at an approved reverse proxy. Forward only to `127.0.0.1:8080`, preserve `Host`, and set `X-Forwarded-Proto`. Apply:

- HTTP-to-HTTPS redirection.
- HSTS after TLS validation.
- Request body limits at or below 256 KiB for API routes.
- Connection and upstream timeouts.
- Access logs that redact `Authorization`, cookies, and query-string secrets.
- Redaction of `X-MetricOps-Signature`; never log webhook bodies at the proxy.
- A source-IP allow-list for Alertmanager signing relays and the same 256 KiB body limit on webhook routes.
- Source-IP restrictions for administrative endpoints where operationally possible.

Do not enable `TRUST_PROXY=true` unless the API can receive traffic only from the trusted proxy network.

The worker runs bounded maintenance hourly. It retains webhook replay receipts for 24 hours, deletes expired idempotency/session records, and removes terminal jobs older than 30 days. The database functions reject unsafe retention values, and only `metricops_worker` may execute them. Alert on repeated `maintenance_failed` events.

## 7. Backup and restore

At minimum, take encrypted PostgreSQL backups at the frequency required by the approved RPO and run scheduled restore drills against an isolated PostgreSQL cluster. The repository provides Node.js commands that keep database passwords out of process arguments, validate secret-file permissions, verify the PostgreSQL custom archive, encrypt it with AES-256-GCM using a scrypt-derived key, and publish a SHA-256 manifest.

Prepare storage. `BACKUP_TEMP_DIRECTORY` must be a private tmpfs mount so the transient unencrypted archive never reaches persistent disk:

```bash
install -d -m 0700 /var/lib/metricops-backups /run/metricops-backup-tmp
mount -t tmpfs -o size=2G,mode=0700,nosuid,nodev,noexec tmpfs /run/metricops-backup-tmp
openssl rand -base64 48 > /run/secrets/metricops/backup_encryption_key
chmod 0600 /run/secrets/metricops/backup_encryption_key
```

Create a mode `0600` administrator database-URL file dedicated to backup operations. Then run:

```bash
BACKUP_DIRECTORY=/var/lib/metricops-backups \
BACKUP_DATABASE_URL_FILE=/run/secrets/metricops/backup_database_url \
BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/metricops/backup_encryption_key \
BACKUP_TEMP_DIRECTORY=/run/metricops-backup-tmp \
DATABASE_SSL_MODE=verify-full \
DATABASE_CA_FILE=/run/secrets/metricops/postgres_ca.crt \
npm run backup:create
```

Treat a backup as committed only when both `.dump.enc` and `.manifest.json` exist. Replicate them to encrypted, immutable object storage with retention lock. Apply retention through that storage system rather than an unreviewed recursive filesystem command. Alert on command failure, missing daily manifests, unexpected size changes, and replication lag.

Run the restore drill from an isolated host against a separate PostgreSQL cluster. The target name must end in `_restore_test`; the command refuses to overwrite an existing database, verifies the encrypted artifact and archive, restores with `--exit-on-error`, checks required schema objects, and drops only the database it created unless `KEEP_RESTORE_DATABASE=true` is explicitly set:

```bash
RESTORE_BACKUP_FILE=/restore-input/metricops-TIMESTAMP.dump.enc \
RESTORE_MANIFEST_FILE=/restore-input/metricops-TIMESTAMP.manifest.json \
RESTORE_ADMIN_DATABASE_URL_FILE=/run/secrets/metricops/restore_admin_database_url \
RESTORE_DATABASE_NAME=metricops_monthly_restore_test \
BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/metricops/backup_encryption_key \
BACKUP_TEMP_DIRECTORY=/run/metricops-backup-tmp \
DATABASE_SSL_MODE=verify-full \
DATABASE_CA_FILE=/run/secrets/metricops/postgres_ca.crt \
npm run backup:restore-drill
```

Record backup age, artifact hash, restore start/end time, restored schema version, and drill outcome in the operational evidence system. Back up the audit HMAC key and connection-secret source through the approved secrets-management process. Store the backup encryption key separately from backup artifacts and test its recovery. A database backup without those materials is not a complete recovery set.

### Audit integrity anchors

Run audit verification on a trusted operations host with a read-only administrative database identity. The URL and HMAC-key files must be absolute, regular, non-symlink files with mode `0600`:

```bash
AUDIT_DATABASE_URL_FILE=/run/secrets/metricops/audit_database_url \
AUDIT_HMAC_KEY_FILE=/run/secrets/metricops/audit_hmac_key \
DATABASE_SSL_MODE=verify-full \
DATABASE_CA_FILE=/run/secrets/metricops/postgres_ca.crt \
npm run audit:verify > audit-anchor.json
```

Store the resulting anchor in write-once or independently administered storage. On the next verification, mount the prior result read-only and set `AUDIT_EXPECTED_ANCHOR_FILE=/evidence/prior-audit-anchor.json`. The command verifies every event digest and link in bounded database pages, confirms each prior anchor still exists, and fails if a tenant chain was changed or truncated. Never overwrite the prior anchor until the new result is independently retained.

## 8. Upgrade and rollback

1. Back up the database and verify the backup artifact.
2. Build and scan the candidate image; record its immutable digest.
3. Review migrations for backward compatibility and lock impact.
4. Run the migration job.
5. Deploy the new image and verify readiness, authentication, tenant isolation, and a known connection check.
6. Roll back the image if health checks fail. If a migration is not backward compatible, follow its reviewed restore/forward-fix plan; do not improvise destructive SQL.

## 9. Health checks and operational metrics

`GET /health/live` confirms only that the API process can serve requests. `GET /health/ready` performs a bounded PostgreSQL check and returns `503` without internal error details when the dependency is unavailable. Use liveness to restart a wedged process and readiness to remove an instance from service; do not make liveness depend on PostgreSQL.

`GET /internal/metrics` exposes Prometheus text format and requires the separate bearer token in `metrics_bearer_token`. It never emits customer IDs, resource IDs, connection IDs, request IDs, URLs, or exception messages. HTTP metrics use route templates rather than actual request paths to prevent both sensitive-label leakage and unbounded cardinality.

The worker exposes `GET /health/live` and the same authenticated `GET /internal/metrics` contract on its private port `9091`. Worker series identify only the bounded job kind and outcome; they do not carry tenant, job, connection, or resource identifiers. Do not publish port 9091 on the host or public load balancer.

Configure the monitoring Prometheus over the protected reverse-proxy route:

```yaml
scrape_configs:
  - job_name: metricops-api
    scheme: https
    metrics_path: /internal/metrics
    authorization:
      type: Bearer
      credentials_file: /run/secrets/metricops_metrics_token
    static_configs:
      - targets: [metricops.example.gov]
  - job_name: metricops-worker
    scheme: http
    metrics_path: /internal/metrics
    authorization:
      type: Bearer
      credentials_file: /run/secrets/metricops_metrics_token
    static_configs:
      - targets: [worker:9091]
```

Allow the metrics path only from the monitoring network, retain application-level bearer authentication, and never put the token in a URL. At minimum alert on readiness remaining zero, sustained 5xx rate, p95 request latency, database pool waiters, process restarts, event-loop delay, memory pressure, missing backup manifests, and failed restore drills. Avoid alert labels containing customer or resource identifiers in platform-wide channels.

## 10. Production acceptance gates

- Replace the single PostgreSQL container with an approved encrypted, highly available service where required.
- Use a managed secret store or orchestrator secret mechanism; rotate all bootstrap secrets.
- Restrict container egress with host firewall, Kubernetes NetworkPolicy, or an egress proxy in addition to application allow-lists.
- Export logs and audit digests to write-protected storage.
- Configure database, API, disk, certificate, and backup-failure alerting.
- Run dependency, source, image, configuration, and SBOM scans.
- Require the `backend-security-gates` CI job before merge; it compiles, runs unit and live PostgreSQL isolation tests, audits production dependencies, validates Compose, and builds the runtime image.
- Complete tenant-isolation, load, restore, failover, and independent penetration tests.
- Document RTO, RPO, availability objective, data residency, and retention with the customer.

The supplied Compose deployment is not evidence by itself that these production gates have been met.
