import pg from "pg";
import type { AppConfig } from "../config.js";

const { Pool } = pg;

export function createPool(config: AppConfig): pg.Pool {
  const ssl = config.databaseSslMode === "disable"
    ? false
    : {
        rejectUnauthorized: config.databaseSslMode === "verify-full",
        ...(config.databaseCa ? { ca: config.databaseCa } : {}),
      };
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
    application_name: "metricops-control-plane",
  });
  pool.on("error", (error: NodeJS.ErrnoException & { code?: string }) => {
    console.error(JSON.stringify({
      level: "fatal",
      event: "database_pool_error",
      errorCode: typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : "UNKNOWN",
    }));
  });
  return pool;
}
