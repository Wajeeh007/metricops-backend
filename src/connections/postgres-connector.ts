import pg from "pg";
import type { FileSecretProvider } from "../secrets/file-secret-provider.js";
import type { EgressPolicy } from "../security/egress-policy.js";
import type { ConnectionCheck, ConnectionRecord, Connector } from "./types.js";

export class PostgresConnector implements Connector {
  readonly kind = "postgresql" as const;

  constructor(
    private readonly secrets: FileSecretProvider,
    private readonly egress: EgressPolicy,
    private readonly timeoutMs: number,
  ) {}

  async validate(connection: ConnectionRecord): Promise<ConnectionCheck> {
    if (connection.kind !== "postgresql" || !("host" in connection.configuration) || !connection.secretRef ||
        !validStoredDatabaseConfiguration(connection.configuration, "verify-full", 63)) {
      throw new Error("PostgreSQL connector received an incompatible connection record");
    }
    const startedAt = performance.now();
    const checkedAt = new Date();
    const resolvedAddress = await this.egress.resolveAllowed(connection.configuration.host);
    const secret = await this.secrets.getDatabaseSecret(connection.secretRef);
    const client = new pg.Client({
      host: resolvedAddress,
      port: connection.configuration.port,
      database: connection.configuration.database,
      user: secret.username,
      password: secret.password,
      connectionTimeoutMillis: this.timeoutMs,
      query_timeout: this.timeoutMs,
      statement_timeout: this.timeoutMs,
      application_name: "metricops-connection-check",
      ssl: {
        rejectUnauthorized: true,
        servername: connection.configuration.host,
        ...(secret.ca ? { ca: secret.ca } : {}),
      },
    });
    try {
      await client.connect();
      const result = await client.query<{ database_name: string; server_version: string }>(
        "SELECT current_database() AS database_name, current_setting('server_version') AS server_version",
      );
      const row = result.rows[0];
      return {
        healthy: true,
        checkedAt,
        latencyMs: Math.round(performance.now() - startedAt),
        metadata: {
          database: row?.database_name ?? connection.configuration.database,
          serverVersion: row?.server_version ?? "unknown",
        },
      };
    } catch {
      return {
        healthy: false,
        checkedAt,
        latencyMs: Math.round(performance.now() - startedAt),
        metadata: {},
        errorCode: "CONNECTION_CHECK_FAILED",
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

function validStoredDatabaseConfiguration(configuration: { host: string; port: number; database: string; sslMode: string }, sslMode: string, databaseMax: number): boolean {
  return /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$|^(?:\d{1,3}\.){3}\d{1,3}$/.test(configuration.host) &&
    Number.isInteger(configuration.port) && configuration.port >= 1 && configuration.port <= 65535 &&
    typeof configuration.database === "string" && configuration.database.length >= 1 && configuration.database.length <= databaseMax && configuration.sslMode === sslMode;
}
