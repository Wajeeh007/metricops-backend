import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { loadConfig } from "../src/config.js";
import { unauthorized } from "../src/domain/errors.js";
import type { Principal } from "../src/domain/principal.js";
import { createApplication } from "../src/http/application.js";
import { OperationalTelemetry } from "../src/observability/operational-telemetry.js";

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://metricops:unused@127.0.0.1:5432/metricops",
  DATABASE_SSL_MODE: "disable",
  OIDC_ISSUER: "https://identity.example.test/realms/metricops",
  OIDC_AUDIENCE: "metricops-api",
  OIDC_JWKS_URI: "https://identity.example.test/jwks",
  CORS_ORIGINS: "https://console.example.test",
  AUDIT_HMAC_KEY: "01234567890123456789012345678901",
});

const principal: Principal = {
  subject: "operator-1",
  customerId: "13f1ae6c-5151-4f8c-8616-908e62f27c71",
  permissions: new Set(["connection:read"]),
  tokenId: "session-1",
  expiresAt: new Date(Date.now() + 60_000),
};

function buildApp(authenticated: boolean, databaseAvailable = true) {
  const pool = { query: async () => databaseAvailable ? ({ rows: [{ "?column?": 1 }] }) : Promise.reject(new Error("private database failure")), totalCount: 1, idleCount: 1, waitingCount: 0 } as never;
  return createApplication({
    config,
    pool,
    authenticator: { authenticate: async () => authenticated ? principal : Promise.reject(unauthorized()) },
    connections: { list: async () => [], create: async () => { throw new Error("unused"); }, validate: async () => { throw new Error("unused"); } } as never,
    customers: { create: async () => { throw new Error("unused"); } } as never,
    sessions: { assertActive: async () => undefined, revokeCurrent: async () => undefined } as never,
    jobs: { enqueueConnectionValidation: async () => { throw new Error("unused"); }, enqueueAwsDiscovery: async () => { throw new Error("unused"); }, get: async () => { throw new Error("unused"); } } as never,
    resources: { create: async () => { throw new Error("unused"); }, list: async () => ({ data: [], nextCursor: null }) } as never,
    metrics: { query: async () => { throw new Error("unused"); } } as never,
    alertmanager: { ingest: async () => ({ accepted: 1, incidentsCreated: 0, incidentsResolved: 0 }) } as never,
    incidents: { listAlerts: async () => [], listIncidents: async () => [], acknowledge: async () => { throw new Error("unused"); }, resolve: async () => { throw new Error("unused"); } } as never,
    reports: { generate: async () => { throw new Error("unused"); } } as never,
    telemetry: new OperationalTelemetry(pool, "01234567890123456789012345678901"),
    auditQuery: { list: async () => [] } as never,
  });
}

test("health endpoint is public and omits Express fingerprint", async () => {
  const response = await request(buildApp(false)).get("/health/live");
  assert.equal(response.status, 200);
  assert.equal(response.headers["x-powered-by"], undefined);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
});

test("protected API fails closed when authentication fails", async () => {
  const response = await request(buildApp(false)).get("/api/v1/connections");
  const body = response.body as { error: { code: string } };
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "AUTHENTICATION_REQUIRED");
});

test("protected API returns tenant-scoped data and correlation ID", async () => {
  const response = await request(buildApp(true))
    .get("/api/v1/connections")
    .set("authorization", "Bearer valid-for-test")
    .set("origin", "https://console.example.test");
  const body = response.body as { data: unknown[]; requestId: string };
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, []);
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers["access-control-allow-origin"], "https://console.example.test");
});

test("CORS rejects unapproved browser origins", async () => {
  const response = await request(buildApp(true))
    .get("/api/v1/connections")
    .set("authorization", "Bearer valid-for-test")
    .set("origin", "https://attacker.example");
  const body = response.body as { error: { code: string } };
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "PERMISSION_DENIED");
});

test("resource APIs deny a principal without inventory permission", async () => {
  const response = await request(buildApp(true)).get("/api/v1/resources").set("authorization", "Bearer valid-for-test");
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "PERMISSION_DENIED");
});

test("audit evidence denies a principal without audit permission", async () => {
  const response = await request(buildApp(true)).get("/api/v1/audit-events").set("authorization", "Bearer valid-for-test");
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "PERMISSION_DENIED");
});

test("Alertmanager webhook preserves the raw JSON body and does not require OIDC", async () => {
  const response = await request(buildApp(false))
    .post(`/api/v1/webhooks/alertmanager/${principal.customerId}/65a1607e-c424-4df3-a277-629690129b38`)
    .set("content-type", "application/json")
    .set("x-metricops-timestamp", String(Math.floor(Date.now() / 1000)))
    .set("x-metricops-nonce", "018ee90f-1f87-7db2-9d41-e3c18986a821")
    .set("x-metricops-signature", `v1=${"0".repeat(64)}`)
    .send('{"version":"4"}');
  assert.equal(response.status, 202);
  assert.equal(response.body.data.accepted, 1);
});

test("operational metrics require a separate token and expose route templates without tenant identifiers", async () => {
  const app = buildApp(true);
  await request(app).get("/api/v1/connections").set("authorization", "Bearer oidc-token");
  const denied = await request(app).get("/internal/metrics");
  assert.equal(denied.status, 401);
  const response = await request(app).get("/internal/metrics").set("authorization", "Bearer 01234567890123456789012345678901");
  assert.equal(response.status, 200);
  assert.match(response.text, /metricops_http_requests_total/);
  assert.match(response.text, /route="\/api\/v1\/connections"/);
  assert.equal(response.text.includes(principal.customerId), false);
  assert.equal(response.headers["cache-control"], "no-store");
});

test("readiness fails closed and records a sanitized dependency failure", async () => {
  const app = buildApp(false, false);
  const readiness = await request(app).get("/health/ready");
  assert.equal(readiness.status, 503);
  assert.equal(readiness.body.error.code, "DEPENDENCY_UNAVAILABLE");
  assert.equal(JSON.stringify(readiness.body).includes("private database failure"), false);
  const metrics = await request(app).get("/internal/metrics").set("authorization", "Bearer 01234567890123456789012345678901");
  assert.match(metrics.text, /metricops_ready 0/);
  assert.match(metrics.text, /metricops_dependency_failures_total\{dependency="postgresql"\} 1/);
});
