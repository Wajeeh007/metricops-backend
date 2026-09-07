# Security Policy and Engineering Baseline

MetricOps is designed for sensitive multi-tenant infrastructure metadata. Security controls are mandatory release criteria, not optional deployment tuning.

## Implemented foundation

- OIDC JWT verification with an explicit algorithm allow-list, issuer, audience, expiry, token ID, and customer claim.
- Deny-by-default permission checks on protected routes; platform administration is not a wildcard and cannot be combined with customer permissions.
- Tenant identity derived only from the verified access token.
- Tenant-scoped PostgreSQL transactions plus forced row-level security policies.
- Append-only, per-customer HMAC-chained audit events.
- Strict JSON schemas, body limits, correlation IDs, security headers, CORS allow-listing, rate limiting, and server timeouts.
- Secret references rather than secret values, read-only file secret loading, path/symlink checks, and restrictive permission enforcement.
- Destination allow-listing, DNS result validation, connection timeout, query timeout, and full TLS certificate verification for PostgreSQL integrations.
- Durable PostgreSQL jobs with atomic `SKIP LOCKED` claims, expiring leases, bounded retries, idempotency keys, and a separately credentialed non-superuser worker.
- Tenant-scoped resource inventory, signed pagination cursors, same-tenant monitoring foreign keys, and template-only Prometheus queries with range, point, series, sample, response-size, and timeout limits.
- Generic client errors and redaction of authorization headers, cookies, and common secret fields from HTTP logs.
- Non-root, read-only application container with `no-new-privileges` in the supplied Compose deployment.

## Required before production

The current code is an initial secure backend foundation, not a completed security accreditation. Production requires threat modeling for the target deployment, independent penetration testing, software-composition and image scanning, SBOM and build provenance, external secret management, identity-provider logout/revocation coordination, audit export and key rotation, database high availability, tested encrypted backup/restore, disaster recovery, load testing, incident response procedures, and customer-approved network/data-flow diagrams.

## Reporting vulnerabilities

Do not open a public issue containing exploit details, credentials, customer identifiers, network information, or logs. Report suspected vulnerabilities through the organization's private security channel. Include the affected version, reproducible steps with sanitized data, impact, and any known workaround. Rotate exposed credentials immediately through the owning system; do not send secrets in the report.
