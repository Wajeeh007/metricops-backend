import { createServer } from "node:http";
import { AuditService } from "./audit/audit-service.js";
import { AuditQueryService } from "./audit/audit-query-service.js";
import { AlertmanagerService } from "./alerts/alertmanager-service.js";
import { AwsAssumeRoleConnector, DefaultAwsRoleProvider } from "./aws/aws-role-provider.js";
import { loadConfig } from "./config.js";
import { ConnectorRegistry } from "./connections/connector-registry.js";
import { ConnectionService } from "./connections/connection-service.js";
import { PostgresConnector } from "./connections/postgres-connector.js";
import { PrometheusConnector } from "./connections/prometheus-connector.js";
import { MysqlConnector } from "./connections/mysql-connector.js";
import { CustomerService } from "./customers/customer-service.js";
import { JobService } from "./jobs/job-service.js";
import { IncidentService } from "./incidents/incident-service.js";
import { MetricsService } from "./metrics/metrics-service.js";
import { ResourceService } from "./resources/resource-service.js";
import { OperationsReportService } from "./reports/operations-report-service.js";
import { OperationalTelemetry } from "./observability/operational-telemetry.js";
import { createPool } from "./database/pool.js";
import { createApplication, configureServerSecurity } from "./http/application.js";
import { FileSecretProvider } from "./secrets/file-secret-provider.js";
import { EgressPolicy } from "./security/egress-policy.js";
import { OidcAuthenticator } from "./security/authentication.js";
import { SessionService } from "./security/session-service.js";

const config = loadConfig();
if (config.environment === "production" && !config.metricsBearerToken) throw new Error("METRICS_BEARER_TOKEN_FILE is required for the API in production");
const pool = createPool(config);
const audit = new AuditService(config.auditHmacKey);
const sessions = new SessionService(pool, audit);
const registry = new ConnectorRegistry();
const secrets = new FileSecretProvider(config.secretDirectory);
const egress = new EgressPolicy(config.connectionAllowedCidrs, config.connectionAllowedHosts);
const awsRoles = new DefaultAwsRoleProvider(config.connectionTimeoutMs);
registry.register(new PostgresConnector(secrets, egress, config.connectionTimeoutMs));
registry.register(new MysqlConnector(secrets, egress, config.connectionTimeoutMs));
const prometheus = new PrometheusConnector(secrets, egress, config.connectionTimeoutMs);
registry.register(prometheus);
registry.register(new AwsAssumeRoleConnector(awsRoles));
const app = createApplication({
  config,
  pool,
  authenticator: new OidcAuthenticator(config.oidc),
  connections: new ConnectionService(pool, audit, registry),
  customers: new CustomerService(pool, audit),
  sessions,
  jobs: new JobService(pool, audit),
  resources: new ResourceService(pool, audit, config.auditHmacKey),
  metrics: new MetricsService(pool, audit, prometheus),
  alertmanager: new AlertmanagerService(pool, audit, secrets),
  incidents: new IncidentService(pool, audit),
  reports: new OperationsReportService(pool, audit),
  telemetry: new OperationalTelemetry(pool, config.metricsBearerToken),
  auditQuery: new AuditQueryService(pool),
});
const server = createServer(app);
configureServerSecurity(server);

server.listen(config.port, config.host, () => {
  console.info(JSON.stringify({ level: "info", event: "server_started", host: config.host, port: config.port }));
});

async function shutdown(signal: string) {
  console.info(JSON.stringify({ level: "info", event: "shutdown_started", signal }));
  server.closeIdleConnections();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
