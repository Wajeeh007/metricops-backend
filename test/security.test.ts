import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { chmod, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConnectorRegistry } from "../src/connections/connector-registry.js";
import { MysqlConnector } from "../src/connections/mysql-connector.js";
import { PostgresConnector } from "../src/connections/postgres-connector.js";
import { normalizePrometheusMatrix, PrometheusConnector } from "../src/connections/prometheus-connector.js";
import { metricsQuerySchema, operationsReportQuerySchema } from "../src/http/schemas.js";
import { unauthorized } from "../src/domain/errors.js";
import type { Principal } from "../src/domain/principal.js";
import { claimsToPrincipal } from "../src/security/authentication.js";
import { authorize } from "../src/security/authorization.js";
import { EgressPolicy } from "../src/security/egress-policy.js";
import { FileSecretProvider } from "../src/secrets/file-secret-provider.js";
import { parseWebhookEnvelope, verifyWebhookSignature } from "../src/alerts/webhook-signature.js";
import { AwsAssumeRoleConnector } from "../src/aws/aws-role-provider.js";
import { createConnectionSchema } from "../src/http/schemas.js";
import { loadConfig } from "../src/config.js";

test("OIDC claims create a tenant-bound principal and ignore unknown permissions", () => {
  const principal = claimsToPrincipal({
    sub: "operator-1",
    jti: "session-1",
    exp: Math.floor(Date.now() / 1000) + 300,
    customer_id: "13f1ae6c-5151-4f8c-8616-908e62f27c71",
    permissions: ["connection:read", "invented:permission"],
  });
  assert.equal(principal.customerId, "13f1ae6c-5151-4f8c-8616-908e62f27c71");
  assert.deepEqual([...principal.permissions], ["connection:read"]);
  authorize(principal, "connection:read");
  assert.throws(() => authorize(principal, "connection:write"), { code: "PERMISSION_DENIED" });
});

test("OIDC claims without customer context are rejected", () => {
  assert.throws(
    () => claimsToPrincipal({ sub: "operator-1", jti: "session-1", exp: 4_000_000_000, permissions: [] }),
    { code: unauthorized().code },
  );
});

test("platform administration never implies customer infrastructure access", () => {
  const platformAdmin: Principal = {
    subject: "platform-admin",
    customerId: "00000000-0000-4000-8000-000000000001",
    permissions: new Set(["platform:admin"]),
    tokenId: "platform-session",
    expiresAt: new Date(Date.now() + 60_000),
  };
  authorize(platformAdmin, "platform:admin");
  assert.throws(() => authorize(platformAdmin, "connection:read"), { code: "PERMISSION_DENIED" });
  assert.throws(() => claimsToPrincipal({
    sub: "platform-admin",
    jti: "platform-session",
    exp: 4_000_000_000,
    customer_id: platformAdmin.customerId,
    permissions: ["platform:admin", "connection:read"],
  }), { code: "AUTHENTICATION_REQUIRED" });
});

test("egress policy allows only configured networks or exact hosts", async () => {
  const policy = new EgressPolicy(["10.20.0.0/16"], ["203.0.113.10"]);
  assert.equal(await policy.resolveAllowed("10.20.4.8"), "10.20.4.8");
  assert.equal(await policy.resolveAllowed("203.0.113.10"), "203.0.113.10");
  await assert.rejects(() => policy.resolveAllowed("127.0.0.1"), { code: "CONNECTION_TARGET_DENIED" });
  await assert.rejects(() => policy.resolveAllowed("169.254.169.254"), { code: "CONNECTION_TARGET_DENIED" });
});

test("file secret provider rejects traversal, symlinks, and broad permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metricops-secrets-"));
  const secretPath = join(directory, "reporting-db.json");
  await writeFile(secretPath, JSON.stringify({ username: "monitor", password: "not-logged" }), { mode: 0o600 });
  const provider = new FileSecretProvider(directory);
  assert.equal((await provider.getDatabaseSecret("file:reporting-db")).username, "monitor");
  await assert.rejects(() => provider.getDatabaseSecret("file:../outside"), { code: "INVALID_SECRET_REFERENCE" });
  const targetPath = join(directory, "target.json");
  await writeFile(targetPath, JSON.stringify({ username: "monitor", password: "not-logged" }), { mode: 0o600 });
  await symlink(targetPath, join(directory, "linked.json"));
  await assert.rejects(() => provider.getDatabaseSecret("file:linked"), { code: "SECRET_UNAVAILABLE" });
  await chmod(secretPath, 0o644);
  await assert.rejects(() => provider.getDatabaseSecret("file:reporting-db"), { code: "INSECURE_SECRET_PERMISSIONS" });
});

test("HTTP secrets require exactly one authentication method", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metricops-http-secrets-"));
  await writeFile(join(directory, "prometheus.json"), JSON.stringify({ bearerToken: "token" }), { mode: 0o600 });
  await writeFile(join(directory, "ambiguous.json"), JSON.stringify({ bearerToken: "token", username: "u", password: "p" }), { mode: 0o600 });
  const provider = new FileSecretProvider(directory);
  assert.equal((await provider.getHttpSecret("file:prometheus")).bearerToken, "token");
  assert.deepEqual(await provider.getHttpSecret(null), {});
  await assert.rejects(() => provider.getHttpSecret("file:ambiguous"), { code: "INVALID_SECRET" });
});

test("webhook secrets require a high-entropy HMAC key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metricops-webhook-secrets-"));
  await writeFile(join(directory, "alerts.json"), JSON.stringify({ hmacKey: "01234567890123456789012345678901" }), { mode: 0o600 });
  await writeFile(join(directory, "weak.json"), JSON.stringify({ hmacKey: "too-short" }), { mode: 0o600 });
  const provider = new FileSecretProvider(directory);
  assert.equal((await provider.getWebhookSecret("file:alerts")).hmacKey.length, 32);
  await assert.rejects(() => provider.getWebhookSecret("file:weak"), { code: "INVALID_SECRET" });
});

test("webhook signatures bind timestamp, nonce, and exact body bytes", () => {
  const key = "01234567890123456789012345678901";
  const body = Buffer.from('{"alerts":[]}');
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const signature = createHmac("sha256", key).update(`${timestamp}.${nonce}.`).update(body).digest("hex");
  const envelope = parseWebhookEnvelope({
    "x-metricops-timestamp": String(timestamp),
    "x-metricops-nonce": nonce,
    "x-metricops-signature": `v1=${signature}`,
  });
  assert.doesNotThrow(() => verifyWebhookSignature(envelope, body, key));
  assert.throws(() => verifyWebhookSignature(envelope, Buffer.from('{"alerts":[1]}'), key), { code: "AUTHENTICATION_REQUIRED" });
  assert.throws(() => parseWebhookEnvelope({
    "x-metricops-timestamp": String(timestamp - 301),
    "x-metricops-nonce": nonce,
    "x-metricops-signature": `v1=${signature}`,
  }, timestamp * 1000), { code: "AUTHENTICATION_REQUIRED" });
});

test("connector registry is explicit and rejects unregistered kinds", () => {
  const registry = new ConnectorRegistry();
  registry.register({ kind: "postgresql", validate: async () => ({ healthy: true, checkedAt: new Date(), latencyMs: 1, metadata: {} }) });
  assert.deepEqual(registry.supportedKinds(), ["postgresql"]);
  assert.throws(() => registry.register({ kind: "postgresql", validate: async () => ({ healthy: true, checkedAt: new Date(), latencyMs: 1, metadata: {} }) }));
});

test("Prometheus connector revalidates stored destinations before credential use", async () => {
  const connector = new PrometheusConnector({} as never, {} as never, 1_000);
  await assert.rejects(() => connector.validate({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    customerId: "11111111-1111-4111-8111-111111111111",
    name: "tampered",
    kind: "prometheus",
    configuration: { baseUrl: "http://169.254.169.254", healthPath: "/-/ready" },
    secretRef: "file:prometheus",
    status: "pending",
    lastValidatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }), /security policy/);
});

test("Prometheus matrix normalization enforces labels, series, and sample limits", () => {
  const normalized = normalizePrometheusMatrix({ status: "success", data: { resultType: "matrix", result: [{ metric: { instance: "host-1" }, values: [[1_788_000_000, "1"]] }] } });
  assert.deepEqual(normalized, [{ labels: { instance: "host-1" }, values: [{ timestamp: 1_788_000_000, value: "1" }] }]);
  assert.throws(() => normalizePrometheusMatrix({ status: "success", data: { resultType: "matrix", result: Array.from({ length: 101 }, () => ({ metric: {}, values: [] })) } }), /series limit/);
  assert.throws(() => normalizePrometheusMatrix({ status: "success", data: { resultType: "matrix", result: [{ metric: { "bad-label": "x" }, values: [] }] } }), /label/);
});

test("metrics query schema rejects excessive ranges and point counts", () => {
  const end = new Date();
  const valid = { resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", queryId: "host.up", start: new Date(end.getTime() - 3_600_000).toISOString(), end: end.toISOString(), stepSeconds: 30 };
  assert.equal(metricsQuerySchema.safeParse(valid).success, true);
  assert.equal(metricsQuerySchema.safeParse({ ...valid, start: new Date(end.getTime() - 172_800_000).toISOString() }).success, false);
  assert.equal(metricsQuerySchema.safeParse({ ...valid, stepSeconds: 1 }).success, false);
});

test("operations reports are limited to valid historical 90-day windows", () => {
  const end = new Date();
  const valid = { start: new Date(end.getTime() - 86_400_000).toISOString(), end: end.toISOString() };
  assert.equal(operationsReportQuerySchema.safeParse(valid).success, true);
  assert.equal(operationsReportQuerySchema.safeParse({ ...valid, start: new Date(end.getTime() - 91 * 86_400_000).toISOString() }).success, false);
  assert.equal(operationsReportQuerySchema.safeParse({ start: end.toISOString(), end: new Date(end.getTime() - 1_000).toISOString() }).success, false);
});

test("AWS connection schema permits AssumeRole only and rejects access-key fields", () => {
  const input = {
    name: "Production AWS", kind: "aws_assume_role",
    configuration: {
      roleArn: "arn:aws:iam::123456789012:role/MetricOpsReadOnly",
      externalId: "customer-generated-external-id",
      regions: ["us-east-1", "eu-west-1"],
      resourceTypes: ["aws_ec2", "aws_rds"], maxResources: 1000,
    },
    secretRef: null,
  };
  assert.equal(createConnectionSchema.safeParse(input).success, true);
  assert.equal(createConnectionSchema.safeParse({ ...input, configuration: { ...input.configuration, accessKeyId: "AKIAEXAMPLE" } }).success, false);
  assert.equal(createConnectionSchema.safeParse({ ...input, secretRef: "file:aws-keys" }).success, false);
});

test("AWS validation uses temporary assumed identity and returns no credential material", async () => {
  const connector = new AwsAssumeRoleConnector({ assume: async () => ({ credentials: { accessKeyId: "temporary", secretAccessKey: "never-returned", sessionToken: "never-returned" }, accountId: "123456789012" }) });
  const result = await connector.validate({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", customerId: "11111111-1111-4111-8111-111111111111", name: "AWS", kind: "aws_assume_role",
    configuration: { roleArn: "arn:aws:iam::123456789012:role/MetricOps", externalId: "external-identifier-value", regions: ["us-east-1"], resourceTypes: ["aws_ec2"], maxResources: 100 },
    secretRef: null, status: "pending", lastValidatedAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal(result.healthy, true);
  assert.deepEqual(result.metadata, { accountId: "123456789012", authentication: "assume-role" });
  assert.equal(JSON.stringify(result).includes("never-returned"), false);
});

test("production configuration rejects static AWS credential sources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metricops-config-secrets-"));
  const metricsTokenFile = join(directory, "metrics-token");
  const databaseUrlFile = join(directory, "database-url");
  const auditKeyFile = join(directory, "audit-key");
  await writeFile(metricsTokenFile, "01234567890123456789012345678901", { mode: 0o600 });
  await writeFile(databaseUrlFile, "postgresql://metricops_app:password@database.example/metricops", { mode: 0o600 });
  await writeFile(auditKeyFile, "01234567890123456789012345678901", { mode: 0o600 });
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    DATABASE_URL_FILE: databaseUrlFile,
    OIDC_ISSUER: "https://identity.example/realms/metricops",
    OIDC_AUDIENCE: "metricops-api",
    OIDC_JWKS_URI: "https://identity.example/jwks",
    CORS_ORIGINS: "https://metricops.example",
    AUDIT_HMAC_KEY_FILE: auditKeyFile,
    METRICS_BEARER_TOKEN_FILE: metricsTokenFile,
    AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    AWS_SECRET_ACCESS_KEY: "not-allowed",
  }), /workload identity/);
});

test("configuration rejects a broadly readable metrics credential file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metricops-metrics-config-"));
  const token = join(directory, "metrics-token");
  await writeFile(token, "01234567890123456789012345678901", { mode: 0o644 });
  assert.throws(() => loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://metricops:unused@database.test/metricops",
    DATABASE_SSL_MODE: "disable",
    OIDC_ISSUER: "https://identity.example.test/realms/metricops",
    OIDC_AUDIENCE: "metricops-api",
    OIDC_JWKS_URI: "https://identity.example.test/jwks",
    CORS_ORIGINS: "https://console.example.test",
    AUDIT_HMAC_KEY: "01234567890123456789012345678901",
    METRICS_BEARER_TOKEN_FILE: token,
  }), /Unable to read required secret file/);
});

test("MySQL schema requires certificate identity verification and rejects extra credential fields", () => {
  const input = {
    name: "Customer MySQL", kind: "mysql",
    configuration: { host: "mysql.internal.example", port: 3306, database: "application", sslMode: "verify_identity" },
    secretRef: "file:customer-mysql",
  };
  assert.equal(createConnectionSchema.safeParse(input).success, true);
  assert.equal(createConnectionSchema.safeParse({ ...input, configuration: { ...input.configuration, sslMode: "disabled" } }).success, false);
  assert.equal(createConnectionSchema.safeParse({ ...input, password: "must-not-be-accepted" }).success, false);
});

test("MySQL validation pins the checked address while verifying the original TLS hostname", async () => {
  const statements: string[] = [];
  let captured: Record<string, unknown> | undefined;
  const connector = new MysqlConnector(
    { getDatabaseSecret: async () => ({ username: "metricops_monitor", password: "never-returned", ca: "PRIVATE CA" }) } as never,
    { resolveAllowed: async () => "10.20.30.40" } as never,
    1_500,
    { connect: async (options) => {
      captured = options as unknown as Record<string, unknown>;
      return {
        query: async (sql: string) => {
          statements.push(sql);
          return sql.startsWith("SELECT")
            ? [[{ database_name: "application", server_version: "8.4.1", server_read_only: 1, healthy: 1 }], []]
            : [[], []];
        },
        end: async () => undefined,
      };
    } },
  );
  const result = await connector.validate({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", customerId: "11111111-1111-4111-8111-111111111111", name: "MySQL", kind: "mysql",
    configuration: { host: "mysql.internal.example", port: 3306, database: "application", sslMode: "verify_identity" },
    secretRef: "file:customer-mysql", status: "pending", lastValidatedAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal(result.healthy, true);
  assert.deepEqual(result.metadata, { database: "application", serverVersion: "8.4.1", serverReadOnly: "true" });
  assert.equal(captured?.host, "mysql.internal.example");
  assert.equal(typeof captured?.stream, "function");
  assert.deepEqual(captured?.ssl, { rejectUnauthorized: true, minVersion: "TLSv1.2", verifyIdentity: true, ca: "PRIVATE CA" });
  assert.deepEqual(statements, ["SET SESSION MAX_EXECUTION_TIME = ?", "START TRANSACTION READ ONLY", "SELECT DATABASE() AS database_name, VERSION() AS server_version, @@read_only AS server_read_only, healthy FROM metricops_health LIMIT 1", "ROLLBACK"]);
  assert.equal(JSON.stringify(result).includes("never-returned"), false);
});

test("database connectors reject tampered stored configuration before reading secrets", async () => {
  let secretReads = 0;
  let resolutions = 0;
  const secrets = { getDatabaseSecret: async () => { secretReads += 1; return { username: "u", password: "p" }; } } as never;
  const egress = { resolveAllowed: async () => { resolutions += 1; return "10.0.0.1"; } } as never;
  const record = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", customerId: "11111111-1111-4111-8111-111111111111", name: "tampered",
    kind: "postgresql" as const, configuration: { host: "metadata/endpoint", port: 5432, database: "app", sslMode: "verify-full" as const },
    secretRef: "file:test", status: "pending" as const, lastValidatedAt: null, createdAt: new Date(), updatedAt: new Date(),
  };
  await assert.rejects(() => new PostgresConnector(secrets, egress, 1_000).validate(record));
  assert.equal(secretReads, 0);
  assert.equal(resolutions, 0);
});
