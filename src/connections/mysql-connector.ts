import mysql, { type ConnectionOptions } from "mysql2/promise";
import { createConnection as createTcpConnection } from "node:net";
import type { MysqlConnectionConfiguration, ConnectionCheck, ConnectionRecord, Connector } from "./types.js";
import type { FileSecretProvider } from "../secrets/file-secret-provider.js";
import type { EgressPolicy } from "../security/egress-policy.js";

interface MysqlSession {
  query(sql: string, values?: readonly unknown[]): Promise<[unknown, unknown]>;
  end(): Promise<void>;
}

export interface MysqlClientFactory {
  connect(options: ConnectionOptions): Promise<MysqlSession>;
}

const defaultFactory: MysqlClientFactory = {
  connect: async (options) => mysql.createConnection(options) as unknown as MysqlSession,
};

export class MysqlConnector implements Connector {
  readonly kind = "mysql" as const;

  constructor(
    private readonly secrets: FileSecretProvider,
    private readonly egress: EgressPolicy,
    private readonly timeoutMs: number,
    private readonly clients: MysqlClientFactory = defaultFactory,
  ) {}

  async validate(connection: ConnectionRecord): Promise<ConnectionCheck> {
    const configuration = validateConfiguration(connection);
    const startedAt = performance.now();
    const checkedAt = new Date();
    const resolvedAddress = await this.egress.resolveAllowed(configuration.host);
    const secret = await this.secrets.getDatabaseSecret(connection.secretRef!);
    let session: MysqlSession | undefined;
    try {
      session = await this.clients.connect({
        // Keep the original hostname for TLS identity verification while the
        // custom stream pins the TCP connection to the policy-checked address.
        host: configuration.host,
        port: configuration.port,
        stream: () => createTcpConnection({ host: resolvedAddress, port: configuration.port }),
        database: configuration.database,
        user: secret.username,
        password: secret.password,
        connectTimeout: this.timeoutMs,
        multipleStatements: false,
        enableKeepAlive: false,
        ssl: {
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
          verifyIdentity: true,
          ...(secret.ca ? { ca: secret.ca } : {}),
        },
      });
      await session.query("SET SESSION MAX_EXECUTION_TIME = ?", [this.timeoutMs]);
      await session.query("START TRANSACTION READ ONLY");
      const [rows] = await session.query("SELECT DATABASE() AS database_name, VERSION() AS server_version, @@read_only AS server_read_only, healthy FROM metricops_health LIMIT 1");
      await session.query("ROLLBACK");
      const row = Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? rows[0] as Record<string, unknown> : {};
      if (row.healthy !== 1 && row.healthy !== "1") throw new Error("MySQL health view returned an invalid value");
      return {
        healthy: true, checkedAt, latencyMs: Math.round(performance.now() - startedAt),
        metadata: {
          database: typeof row.database_name === "string" ? row.database_name : configuration.database,
          serverVersion: typeof row.server_version === "string" ? row.server_version.slice(0, 120) : "unknown",
          serverReadOnly: row.server_read_only === 1 || row.server_read_only === "1" ? "true" : "false",
        },
      };
    } catch {
      return { healthy: false, checkedAt, latencyMs: Math.round(performance.now() - startedAt), metadata: {}, errorCode: "CONNECTION_CHECK_FAILED" };
    } finally {
      await session?.end().catch(() => undefined);
    }
  }
}

function validateConfiguration(connection: ConnectionRecord): MysqlConnectionConfiguration {
  if (connection.kind !== "mysql" || !connection.secretRef || !("host" in connection.configuration)) throw new Error("MySQL connector received an incompatible connection record");
  const value = connection.configuration as MysqlConnectionConfiguration;
  const validHost = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$|^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.host);
  if (!validHost || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.database !== "string" || value.database.length < 1 || value.database.length > 64 || value.sslMode !== "verify_identity") {
    throw new Error("Stored MySQL configuration violates connector security policy");
  }
  return value;
}
