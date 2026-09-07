# MetricOps Postman package

Import `MetricOps-Frontend-Integration.postman_collection.json`, then select either the Local or Staging environment.

## Before sending requests

1. Set `access_token` to an OIDC access token. Do not store it in the collection or commit an exported environment containing it.
2. Set returned IDs (`connection_id`, `job_id`, `resource_id`, and `incident_id`) as you progress through the collection.
3. Use a new UUID in `idempotency_key` for every new create, queue, acknowledge, or resolve action. Keep that exact value only when retrying the same request.
4. For staging, replace the example `api.staging.metricops.example` hostname with the deployed API hostname.

## Staging prerequisites

Set the backend's `CORS_ORIGINS` to the exact HTTPS dashboard origin, for example `https://dashboard.staging.metricops.example`; do not use `*`. Configure the identity provider's staging client with that same redirect origin, the MetricOps API audience, and the required claims. The staging environment intentionally contains no real token, credential, or webhook-secret value.

The dashboard token must include `sub`, `jti`, `customer_id`, and only the permissions necessary for the screen: `connection:read`, `resource:read`, `metrics:read`, `alert:read`, `incident:read`, `incident:write`, `report:read`, or `audit:read`. The API derives tenant scope from the token; frontend clients must never attempt to choose a tenant through a query parameter, header, or body field.

## Frontend rules

- Use `api_base_url` for browser API calls; it already includes `/api/v1`.
- Send `Authorization: Bearer <OIDC token>` and preserve the API's `requestId` in client-side error telemetry.
- Handle `401` by renewing/re-authenticating, `403` by hiding unauthorized capabilities, `409` as an idempotency or optimistic-concurrency conflict, and `429` with backoff.
- Poll the job URL returned in the `Location` header for connection validation and AWS discovery; do not keep the browser request open.
- Never call `/internal/metrics` from a browser and never include connection credentials or the Alertmanager HMAC key in frontend code.

The collection includes a service-to-service Alertmanager request for reference only. It is intentionally not usable from a browser.

For schemas and the full API contract, use `../openapi/metricops-v1.yaml`. For secure database and monitoring onboarding, use `../docs/guides/INTEGRATIONS.md`.
