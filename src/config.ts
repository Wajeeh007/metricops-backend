import { z } from "zod";
import { isIP } from "node:net";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

const booleanValue = z.enum(["true", "false"]).transform((value) => value === "true");

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().refine((value) => isIP(value) !== 0, "HOST must be an IP address").default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_URL_FILE: z.string().startsWith("/").optional(),
  DATABASE_SSL_MODE: z.enum(["disable", "require", "verify-full"]).default("verify-full"),
  DATABASE_CA_FILE: z.string().startsWith("/").optional(),
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_JWKS_URI: z.string().url(),
  OIDC_MAX_TOKEN_AGE_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  CORS_ORIGINS: z.string().min(1),
  TRUST_PROXY: booleanValue.default(false),
  AUDIT_HMAC_KEY: z.string().min(32).optional(),
  AUDIT_HMAC_KEY_FILE: z.string().startsWith("/").optional(),
  SECRET_DIRECTORY: z.string().startsWith("/").default("/run/secrets/metricops"),
  CONNECTION_ALLOWED_CIDRS: z.string().default(""),
  CONNECTION_ALLOWED_HOSTS: z.string().default(""),
  CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  METRICS_BEARER_TOKEN_FILE: z.string().startsWith("/").optional(),
  WORKER_METRICS_HOST: z.string().refine((value) => isIP(value) !== 0, "WORKER_METRICS_HOST must be an IP address").default("127.0.0.1"),
  WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9091),
}).superRefine((value, context) => {
  if ((value.DATABASE_URL ? 1 : 0) + (value.DATABASE_URL_FILE ? 1 : 0) !== 1) {
    context.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "Set exactly one of DATABASE_URL or DATABASE_URL_FILE" });
  }
  if ((value.AUDIT_HMAC_KEY ? 1 : 0) + (value.AUDIT_HMAC_KEY_FILE ? 1 : 0) !== 1) {
    context.addIssue({ code: "custom", path: ["AUDIT_HMAC_KEY"], message: "Set exactly one of AUDIT_HMAC_KEY or AUDIT_HMAC_KEY_FILE" });
  }
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid or missing configuration: ${fields}`);
  }
  const value = parsed.data;
  const databaseUrl = (value.DATABASE_URL ?? readSecretFile(value.DATABASE_URL_FILE!)).trim();
  const auditHmacKey = (value.AUDIT_HMAC_KEY ?? readSecretFile(value.AUDIT_HMAC_KEY_FILE!)).trim();
  const metricsBearerToken = value.METRICS_BEARER_TOKEN_FILE ? readSecretFile(value.METRICS_BEARER_TOKEN_FILE).trim() : null;
  if (!z.string().url().safeParse(databaseUrl).success) throw new Error("DATABASE_URL is invalid");
  if (auditHmacKey.length < 32) throw new Error("AUDIT_HMAC_KEY must contain at least 32 characters");
  if (metricsBearerToken !== null && (metricsBearerToken.length < 32 || metricsBearerToken.length > 512)) throw new Error("Metrics bearer token must contain 32 to 512 characters");
  if (value.NODE_ENV === "production" && value.DATABASE_SSL_MODE === "disable") {
    throw new Error("DATABASE_SSL_MODE cannot be disable in production");
  }
  if (value.NODE_ENV === "production") {
    if (value.DATABASE_URL || value.AUDIT_HMAC_KEY) throw new Error("Production database and audit secrets must be supplied through protected files");
    if (environment.AWS_ACCESS_KEY_ID || environment.AWS_SECRET_ACCESS_KEY || environment.AWS_PROFILE) {
      throw new Error("Static AWS credential environment variables are forbidden in production; use workload identity");
    }
    for (const [name, endpoint] of [["OIDC_ISSUER", value.OIDC_ISSUER], ["OIDC_JWKS_URI", value.OIDC_JWKS_URI]] as const) {
      if (new URL(endpoint).protocol !== "https:") throw new Error(`${name} must use HTTPS in production`);
    }
    if (value.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean).some((origin) => new URL(origin).protocol !== "https:")) {
      throw new Error("CORS_ORIGINS must use HTTPS in production");
    }
  }
  return {
    environment: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    databaseUrl,
    databaseSslMode: value.DATABASE_SSL_MODE,
    databaseCa: value.DATABASE_CA_FILE ? readSecretFile(value.DATABASE_CA_FILE, false) : undefined,
    oidc: {
      issuer: value.OIDC_ISSUER.replace(/\/$/, ""),
      audience: value.OIDC_AUDIENCE,
      jwksUri: value.OIDC_JWKS_URI,
      maxTokenAgeSeconds: value.OIDC_MAX_TOKEN_AGE_SECONDS,
    },
    corsOrigins: value.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    trustProxy: value.TRUST_PROXY,
    auditHmacKey,
    secretDirectory: value.SECRET_DIRECTORY,
    connectionAllowedCidrs: value.CONNECTION_ALLOWED_CIDRS.split(",").map((item) => item.trim()).filter(Boolean),
    connectionAllowedHosts: value.CONNECTION_ALLOWED_HOSTS.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
    connectionTimeoutMs: value.CONNECTION_TIMEOUT_MS,
    rateLimit: { max: value.RATE_LIMIT_MAX, window: value.RATE_LIMIT_WINDOW },
    metricsBearerToken,
    workerMetricsHost: value.WORKER_METRICS_HOST,
    workerMetricsPort: value.WORKER_METRICS_PORT,
  } as const;
}

function readSecretFile(path: string, sensitive = true): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & (sensitive ? 0o077 : 0o022)) !== 0) throw new Error("unsafe permissions");
    return readFileSync(descriptor, { encoding: "utf8" });
  } catch {
    throw new Error(`Unable to read required secret file: ${path}`);
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
