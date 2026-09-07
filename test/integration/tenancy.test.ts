import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { AlertmanagerService } from "../../src/alerts/alertmanager-service.js";
import { AwsDiscoveryService } from "../../src/aws/aws-discovery-service.js";
import type { AwsInventoryProvider } from "../../src/aws/aws-inventory-provider.js";
import { AuditService } from "../../src/audit/audit-service.js";
import { AuditQueryService } from "../../src/audit/audit-query-service.js";
import type { Principal } from "../../src/domain/principal.js";
import { IncidentService } from "../../src/incidents/incident-service.js";
import { JobService, type JobRecord } from "../../src/jobs/job-service.js";
import { OperationsReportService } from "../../src/reports/operations-report-service.js";
import { FileSecretProvider } from "../../src/secrets/file-secret-provider.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
const workerUrl = process.env.TEST_DATABASE_WORKER_URL;
if (!adminUrl || !appUrl || !workerUrl) throw new Error("TEST_DATABASE_ADMIN_URL, TEST_DATABASE_APP_URL, and TEST_DATABASE_WORKER_URL are required");
if (!new URL(adminUrl).pathname.endsWith("_test")) throw new Error("Integration tests require a database name ending in _test");

const tenantOne = "11111111-1111-4111-8111-111111111111";
const tenantTwo = "22222222-2222-4222-8222-222222222222";
const connectionOne = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const webhookConnection = "77777777-7777-4777-8777-777777777777";
const awsConnection = "88888888-8888-4888-8888-888888888888";
const mysqlConnection = "99999999-9999-4999-8999-999999999999";
const audit = new AuditService("01234567890123456789012345678901");

const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 2 });
const worker = new pg.Pool({ connectionString: workerUrl, max: 2 });
const workerJobs = new JobService(worker, audit);

test.before(async () => {
  await admin.query("INSERT INTO customers(id, name) VALUES ($1, 'Tenant One'), ($2, 'Tenant Two') ON CONFLICT (id) DO NOTHING", [tenantOne, tenantTwo]);
  await admin.query("DELETE FROM connections WHERE id = ANY($1)", [[connectionOne, webhookConnection, awsConnection, mysqlConnection]]);
  await admin.query(
    `INSERT INTO connections (id, customer_id, name, kind, configuration, secret_ref, created_by)
     VALUES ($1,$2,'DB','postgresql','{"host":"10.0.0.5","port":5432,"database":"app","sslMode":"verify-full"}','file:test','operator')`,
    [connectionOne, tenantOne],
  );
  await admin.query(
    `INSERT INTO connections (id, customer_id, name, kind, configuration, secret_ref, created_by)
     VALUES ($1,$2,'Alertmanager','alertmanager_webhook','{"sourceName":"pilot-alertmanager"}','file:alerts','operator')`,
    [webhookConnection, tenantOne],
  );
  await admin.query(
    `INSERT INTO connections (id,customer_id,name,kind,configuration,secret_ref,created_by)
     VALUES($1,$2,'AWS','aws_assume_role',$3,NULL,'operator')`,
    [awsConnection, tenantOne, { roleArn: "arn:aws:iam::123456789012:role/MetricOpsReadOnly", externalId: "integration-external-id", regions: ["us-east-1"], resourceTypes: ["aws_ec2", "aws_ebs"], maxResources: 100 }],
  );
  await admin.query(
    `INSERT INTO connections(id,customer_id,name,kind,configuration,secret_ref,created_by)
     VALUES($1,$2,'MySQL','mysql',$3,'file:mysql','operator')`,
    [mysqlConnection, tenantOne, { host: "mysql.internal.example", port: 3306, database: "application", sslMode: "verify_identity" }],
  );
});

test.after(async () => {
  await admin.query("TRUNCATE audit_events, connections, idempotency_records, revoked_sessions, customers RESTART IDENTITY CASCADE");
  await app.end();
  await worker.end();
  await admin.end();
});

async function tenantTransaction<T>(customerId: string, work: (client: pg.PoolClient) => Promise<T>) {
  const client = await app.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_customer_id', $1, true)", [customerId]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("runtime database role cannot bypass row-level security", async () => {
  const result = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'metricops_app'",
  );
  assert.deepEqual(result.rows[0], { rolsuper: false, rolbypassrls: false });
});

test("tenant cannot read another tenant connection", async () => {
  const owned = await tenantTransaction(tenantOne, (client) => client.query("SELECT id FROM connections WHERE id = $1", [connectionOne]));
  assert.equal(owned.rowCount, 1);
  const visible = await tenantTransaction(tenantTwo, (client) => client.query("SELECT id FROM connections WHERE id = $1", [connectionOne]));
  assert.equal(visible.rowCount, 0);
});

test("only the worker role can atomically lease and finish durable jobs", async () => {
  const jobId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await tenantTransaction(tenantOne, (client) => client.query(
    `INSERT INTO jobs (id, customer_id, kind, payload, idempotency_key, created_by)
     VALUES ($1,$2,'connection.validate',$3,'ffffffff-ffff-4fff-8fff-ffffffffffff','operator')`,
    [jobId, tenantOne, { connectionId: connectionOne }],
  ));
  await assert.rejects(
    () => app.query("SELECT * FROM claim_metricops_jobs('33333333-3333-4333-8333-333333333333',1,60)"),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501",
  );
  const claimed = await worker.query("SELECT * FROM claim_metricops_jobs('33333333-3333-4333-8333-333333333333',1,60)");
  assert.equal(claimed.rows[0]?.id, jobId);
  assert.equal(claimed.rows[0]?.status, "running");
  assert.equal(claimed.rows[0]?.attempts, 1);
  const wrongOwner = await worker.query<{ finish_metricops_job: boolean }>(
    "SELECT finish_metricops_job('44444444-4444-4444-8444-444444444444',$1,true,'{}',null)", [jobId],
  );
  assert.equal(wrongOwner.rows[0]?.finish_metricops_job, false);
  const claimedJob: JobRecord = {
    id: claimed.rows[0].id, customerId: claimed.rows[0].customer_id, kind: claimed.rows[0].kind,
    status: claimed.rows[0].status, payload: claimed.rows[0].payload, result: claimed.rows[0].result,
    errorCode: claimed.rows[0].error_code, attempts: claimed.rows[0].attempts, maxAttempts: claimed.rows[0].max_attempts,
    createdAt: claimed.rows[0].created_at, updatedAt: claimed.rows[0].updated_at, completedAt: claimed.rows[0].completed_at,
  };
  await workerJobs.finish("33333333-3333-4333-8333-333333333333", claimedJob, true, { healthy: true }, null);
  const visible = await tenantTransaction(tenantOne, (client) => client.query("SELECT status FROM jobs WHERE id = $1", [jobId]));
  assert.equal(visible.rows[0]?.status, "succeeded");
  const hidden = await tenantTransaction(tenantTwo, (client) => client.query("SELECT status FROM jobs WHERE id = $1", [jobId]));
  assert.equal(hidden.rowCount, 0);
  const audit = await admin.query("SELECT action FROM audit_events WHERE customer_id = $1 AND resource_id = $2", [tenantOne, jobId]);
  assert.equal(audit.rows[0]?.action, "job.succeeded");
});

test("tenant cannot write a row owned by another tenant", async () => {
  await assert.rejects(
    () => tenantTransaction(tenantTwo, (client) => client.query(
      `INSERT INTO connections (id, customer_id, name, kind, configuration, secret_ref, created_by)
       VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$1,'Cross tenant','postgresql','{}','file:test','operator')`,
      [tenantOne],
    )),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501",
  );
});

test("resource inventory is isolated by tenant for reads and writes", async () => {
  const resourceId = "55555555-5555-4555-8555-555555555555";
  await tenantTransaction(tenantOne, (client) => client.query(
    `INSERT INTO resources
     (id,customer_id,provider_id,resource_type,name,environment,criticality,data_classification,tags,source,created_by)
     VALUES ($1,$2,'host-1','linux_host','Host One','pilot','high','restricted','{}','manual','operator')`,
    [resourceId, tenantOne],
  ));
  const hidden = await tenantTransaction(tenantTwo, (client) => client.query("SELECT id FROM resources WHERE id=$1", [resourceId]));
  assert.equal(hidden.rowCount, 0);
  await assert.rejects(
    () => tenantTransaction(tenantTwo, (client) => client.query(
      `INSERT INTO resources
       (id,customer_id,provider_id,resource_type,name,environment,criticality,data_classification,tags,source,created_by)
       VALUES ('66666666-6666-4666-8666-666666666666',$1,'host-x','linux_host','Cross','pilot','low','internal','{}','manual','operator')`,
      [tenantOne],
    )),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501",
  );
});

test("signed Alertmanager delivery is replay-safe and drives an auditable incident lifecycle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metricops-alertmanager-integration-"));
  const hmacKey = "integration-webhook-key-32-bytes-minimum";
  await writeFile(join(directory, "alerts.json"), JSON.stringify({ hmacKey }), { mode: 0o600 });
  const webhook = new AlertmanagerService(app, audit, new FileSecretProvider(directory));
  const incidents = new IncidentService(app, audit);
  const now = new Date();
  const firingBody = Buffer.from(JSON.stringify({
    version: "4",
    status: "firing",
    receiver: "metricops",
    alerts: [{
      status: "firing",
      labels: { alertname: "HostDown", severity: "critical" },
      annotations: { summary: "Pilot host is unavailable", description: "Prometheus cannot scrape the pilot host." },
      startsAt: now.toISOString(),
      fingerprint: "abcdef0123456789",
    }],
  }));
  const nonce = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = signedHeaders(firingBody, timestamp, nonce, hmacKey);
  const accepted = await webhook.ingest(tenantOne, webhookConnection, headers, firingBody, randomUUID());
  assert.deepEqual(accepted, { accepted: 1, incidentsCreated: 1, incidentsResolved: 0 });
  await assert.rejects(
    () => webhook.ingest(tenantOne, webhookConnection, headers, firingBody, randomUUID()),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "WEBHOOK_REPLAYED",
  );

  const operator: Principal = {
    subject: "operator-1", customerId: tenantOne,
    permissions: new Set(["alert:read", "incident:read", "incident:write", "report:read"]),
    tokenId: "integration-session", expiresAt: new Date(Date.now() + 60_000),
  };
  const listed = await incidents.listIncidents(operator, 10);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.status, "open");
  const incidentId = String(listed[0]?.id);
  const acknowledgementKey = randomUUID();
  const acknowledged = await incidents.acknowledge(operator, incidentId, Number(listed[0]?.version), "on-call", acknowledgementKey, randomUUID());
  assert.equal(acknowledged.status, "acknowledged");
  const repeated = await incidents.acknowledge(operator, incidentId, Number(listed[0]?.version), "on-call", acknowledgementKey, randomUUID());
  assert.deepEqual(repeated, acknowledged);

  const end = new Date(Date.now() + 1_000);
  const resolvedBody = Buffer.from(JSON.stringify({
    version: "4", status: "resolved", receiver: "metricops",
    alerts: [{
      status: "resolved", labels: { alertname: "HostDown", severity: "critical" },
      annotations: { summary: "Pilot host is unavailable" }, startsAt: now.toISOString(), endsAt: end.toISOString(), fingerprint: "abcdef0123456789",
    }],
  }));
  const resolvedNonce = randomUUID();
  const resolved = await webhook.ingest(tenantOne, webhookConnection, signedHeaders(resolvedBody, timestamp, resolvedNonce, hmacKey), resolvedBody, randomUUID());
  assert.equal(resolved.incidentsResolved, 1);
  const finalIncident = await incidents.listIncidents(operator, 10);
  assert.equal(finalIncident[0]?.status, "resolved");

  const hidden = await tenantTransaction(tenantTwo, (client) => client.query("SELECT id FROM incidents WHERE id=$1", [incidentId]));
  assert.equal(hidden.rowCount, 0);
  const events = await tenantTransaction(tenantOne, (client) => client.query("SELECT event_type FROM incident_events WHERE incident_id=$1 ORDER BY sequence", [incidentId]));
  assert.deepEqual(events.rows.map((row) => row.event_type), ["created", "acknowledged", "resolved"]);

  const reports = new OperationsReportService(app, audit);
  const report = await reports.generate(operator, new Date(now.getTime() - 1_000), new Date(end.getTime() + 1_000), randomUUID());
  assert.equal(report.alerts.find((row) => row.severity === "critical")?.count, 1);
  assert.equal(report.incidents.find((row) => row.status === "resolved")?.count, 1);
  assert.equal(report.serviceLevels.acknowledgedCount, 1);
  assert.equal(report.serviceLevels.resolvedCount, 1);
  assert.equal(report.currentlyActiveIncidents, 0);
});

test("only the worker can run bounded webhook receipt retention", async () => {
  await assert.rejects(
    () => app.query("SELECT prune_metricops_webhook_receipts(interval '24 hours')"),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501",
  );
  const result = await worker.query<{ prune_metricops_webhook_receipts: string }>("SELECT prune_metricops_webhook_receipts(interval '24 hours')");
  assert.equal(Number(result.rows[0]?.prune_metricops_webhook_receipts), 0);
  await assert.rejects(() => worker.query("SELECT prune_metricops_webhook_receipts(interval '5 minutes')"), /between 10 minutes and 30 days/);
});

test("only the worker can prune expired operational records with bounded retention", async () => {
  await assert.rejects(
    () => app.query("SELECT prune_metricops_operational_records(interval '30 days')"),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501",
  );
  const result = await worker.query<{ prune_metricops_operational_records: { idempotencyRecords: number; revokedSessions: number; jobs: number } }>(
    "SELECT prune_metricops_operational_records(interval '30 days')",
  );
  assert.deepEqual(result.rows[0]?.prune_metricops_operational_records, { idempotencyRecords: 0, revokedSessions: 0, jobs: 0 });
  await assert.rejects(() => worker.query("SELECT prune_metricops_operational_records(interval '12 hours')"), /between 1 day and 365 days/);
});

test("AWS discovery jobs reconcile inventory without crossing tenant boundaries", async () => {
  const operator: Principal = { subject: "operator-1", customerId: tenantOne, permissions: new Set(["resource:discover"]), tokenId: "aws-test", expiresAt: new Date(Date.now() + 60_000) };
  const appJobs = new JobService(app, audit);
  const firstJob = await appJobs.enqueueAwsDiscovery(operator, awsConnection, randomUUID(), randomUUID());
  let invocation = 0;
  const provider: AwsInventoryProvider = {
    discover: async () => {
      invocation += 1;
      const first = { providerId: "i-0123456789abcdef0", resourceType: "aws_ec2" as const, name: "API host", environment: "production", criticality: "critical" as const, dataClassification: "restricted" as const, tags: { service: "api" } };
      const second = { providerId: "vol-0123456789abcdef0", resourceType: "aws_ebs" as const, name: "API volume", environment: "production", criticality: "high" as const, dataClassification: "restricted" as const, tags: { service: "api" } };
      return invocation === 1 ? [first, second] : [first];
    },
  };
  const discovery = new AwsDiscoveryService(worker, audit, provider);
  const first = await discovery.discover(tenantOne, awsConnection, firstJob.id, "worker:integration");
  assert.deepEqual(first, { discovered: 2, markedMissing: 0 });
  const secondJob = await appJobs.enqueueAwsDiscovery(operator, awsConnection, randomUUID(), randomUUID());
  const second = await discovery.discover(tenantOne, awsConnection, secondJob.id, "worker:integration");
  assert.deepEqual(second, { discovered: 1, markedMissing: 1 });
  const visible = await tenantTransaction(tenantOne, (client) => client.query("SELECT provider_id,discovery_state FROM resources WHERE source=$1 ORDER BY provider_id", [`aws:${awsConnection}`]));
  assert.deepEqual(visible.rows, [
    { provider_id: "i-0123456789abcdef0", discovery_state: "active" },
    { provider_id: "vol-0123456789abcdef0", discovery_state: "missing" },
  ]);
  const hidden = await tenantTransaction(tenantTwo, (client) => client.query("SELECT id FROM resources WHERE source=$1", [`aws:${awsConnection}`]));
  assert.equal(hidden.rowCount, 0);
});

test("MySQL validation jobs are tenant scoped and idempotent", async () => {
  const operator: Principal = { subject: "operator-1", customerId: tenantOne, permissions: new Set(["connection:validate"]), tokenId: "mysql-test", expiresAt: new Date(Date.now() + 60_000) };
  const service = new JobService(app, audit);
  const key = randomUUID();
  const first = await service.enqueueConnectionValidation(operator, mysqlConnection, key, randomUUID());
  const repeated = await service.enqueueConnectionValidation(operator, mysqlConnection, key, randomUUID());
  assert.equal(first.id, repeated.id);
  const hidden = await tenantTransaction(tenantTwo, (client) => client.query("SELECT id FROM jobs WHERE id=$1", [first.id]));
  assert.equal(hidden.rowCount, 0);
});

test("audit records reject mutation for both runtime and administrative roles", async () => {
  const auditId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await tenantTransaction(tenantOne, (client) => client.query(
    `INSERT INTO audit_events
     (id, customer_id, actor_id, action, resource_type, resource_id, request_id, occurred_at, details, chain_hash)
     VALUES ($1,$2,'tester','test.created','test','one','dddddddd-dddd-4ddd-8ddd-dddddddddddd',now(),'{}','hash')`,
    [auditId, tenantOne],
  ));
  await assert.rejects(
    () => tenantTransaction(tenantOne, (client) => client.query("UPDATE audit_events SET action = 'changed' WHERE id = $1", [auditId])),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501",
  );
  await assert.rejects(
    () => admin.query("UPDATE audit_events SET action = 'changed' WHERE id = $1", [auditId]),
    /append-only/,
  );
});

test("audit evidence reads remain tenant scoped", async () => {
  const service = new AuditQueryService(app);
  const tenantOneEvents = await service.list({
    subject: "auditor", customerId: tenantOne, permissions: new Set(["audit:read"]),
    tokenId: "audit-session-one", expiresAt: new Date(Date.now() + 60_000),
  }, 100);
  assert.ok(tenantOneEvents.length > 0);
  assert.equal(tenantOneEvents.every((event) => event.chainHash.length > 0), true);
  const tenantTwoEvents = await service.list({
    subject: "auditor", customerId: tenantTwo, permissions: new Set(["audit:read"]),
    tokenId: "audit-session-two", expiresAt: new Date(Date.now() + 60_000),
  }, 100);
  assert.equal(tenantTwoEvents.some((event) => tenantOneEvents.some((owned) => owned.id === event.id)), false);
});

function signedHeaders(body: Buffer, timestamp: number, nonce: string, key: string) {
  const signature = createHmac("sha256", key).update(`${timestamp}.${nonce}.`).update(body).digest("hex");
  return {
    "x-metricops-timestamp": String(timestamp),
    "x-metricops-nonce": nonce,
    "x-metricops-signature": `v1=${signature}`,
  };
}
