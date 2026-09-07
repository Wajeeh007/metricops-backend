import { randomUUID } from "node:crypto";
import { AuditService } from "./audit/audit-service.js";
import { AwsDiscoveryService } from "./aws/aws-discovery-service.js";
import { DefaultAwsInventoryProvider } from "./aws/aws-inventory-provider.js";
import { AwsAssumeRoleConnector, DefaultAwsRoleProvider } from "./aws/aws-role-provider.js";
import { loadConfig } from "./config.js";
import { ConnectorRegistry } from "./connections/connector-registry.js";
import { ConnectionService } from "./connections/connection-service.js";
import { PostgresConnector } from "./connections/postgres-connector.js";
import { PrometheusConnector } from "./connections/prometheus-connector.js";
import { MysqlConnector } from "./connections/mysql-connector.js";
import { createPool } from "./database/pool.js";
import { JobService, type JobRecord } from "./jobs/job-service.js";
import { FileSecretProvider } from "./secrets/file-secret-provider.js";
import { EgressPolicy } from "./security/egress-policy.js";
import { startWorkerTelemetryServer, WorkerTelemetry } from "./observability/worker-telemetry.js";
import { MaintenanceService } from "./operations/maintenance.js";

const config = loadConfig();
if (config.environment === "production" && !config.metricsBearerToken) throw new Error("METRICS_BEARER_TOKEN_FILE is required for the worker in production");
const pool = createPool(config);
const audit = new AuditService(config.auditHmacKey);
const registry = new ConnectorRegistry();
const secrets = new FileSecretProvider(config.secretDirectory);
const egress = new EgressPolicy(config.connectionAllowedCidrs, config.connectionAllowedHosts);
const awsRoles = new DefaultAwsRoleProvider(config.connectionTimeoutMs);
registry.register(new PostgresConnector(secrets, egress, config.connectionTimeoutMs));
registry.register(new MysqlConnector(secrets, egress, config.connectionTimeoutMs));
registry.register(new PrometheusConnector(secrets, egress, config.connectionTimeoutMs));
registry.register(new AwsAssumeRoleConnector(awsRoles));
const connections = new ConnectionService(pool, audit, registry);
const jobs = new JobService(pool, audit);
const awsDiscovery = new AwsDiscoveryService(pool, audit, new DefaultAwsInventoryProvider(awsRoles, config.connectionTimeoutMs));
const workerId = randomUUID();
let stopping = false;
const telemetry = config.metricsBearerToken ? new WorkerTelemetry(pool, config.metricsBearerToken) : null;
const telemetryServer = telemetry ? startWorkerTelemetryServer(config.workerMetricsHost, config.workerMetricsPort, telemetry) : null;
const maintenance = new MaintenanceService(pool);
let nextMaintenanceAt = 0;
let maintenanceRun: Promise<void> | null = null;

async function processJob(job: JobRecord): Promise<void> {
  telemetry?.jobClaimed(job.kind);
  const finishTelemetry = telemetry?.startJob(job.kind) ?? (() => undefined);
  try {
    if (job.kind === "connection.validate") {
      const validation = await connections.validate({
        subject: `worker:${workerId}`,
        customerId: job.customerId,
        permissions: new Set(["connection:validate"]),
        tokenId: job.id,
        expiresAt: new Date(Date.now() + 60_000),
      }, job.payload.connectionId, job.id);
      await jobs.finish(workerId, job, true, validation, null);
      finishTelemetry("succeeded");
      return;
    }
    if (job.kind === "aws.discover") {
      const result = await awsDiscovery.discover(job.customerId, job.payload.connectionId, job.id, `worker:${workerId}`);
      await jobs.finish(workerId, job, true, result, null);
      finishTelemetry("succeeded");
      return;
    }
    throw new Error("Unsupported job kind");
  } catch {
    finishTelemetry("failed");
    console.error(JSON.stringify({ level: "error", event: "job_failed", jobId: job.id, kind: job.kind }));
    await jobs.finish(workerId, job, false, null, "JOB_EXECUTION_FAILED").catch(() => undefined);
  }
}

async function run(): Promise<void> {
  console.info(JSON.stringify({ level: "info", event: "worker_started", workerId }));
  while (!stopping) {
    telemetry?.loop();
    if (Date.now() >= nextMaintenanceAt) {
      nextMaintenanceAt = Date.now() + 3_600_000;
      maintenanceRun = maintenance.run()
        .then((deleted) => console.info(JSON.stringify({ level: "info", event: "maintenance_completed", deleted })))
        .catch(() => console.error(JSON.stringify({ level: "error", event: "maintenance_failed" })))
        .finally(() => { maintenanceRun = null; });
    }
    const claimed = await jobs.claim(workerId, 5, 60).catch(() => {
      telemetry?.claimFailed();
      console.error(JSON.stringify({ level: "error", event: "job_claim_failed" }));
      return [] as readonly JobRecord[];
    });
    if (claimed.length) await Promise.allSettled(claimed.map(processJob));
    else await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await maintenanceRun;
  if (telemetryServer) await new Promise<void>((resolve) => telemetryServer.close(() => resolve()));
  await pool.end();
}

function stop(): void { stopping = true; }
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
await run();
