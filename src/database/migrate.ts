import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";

const config = loadConfig();
const pool = createPool(config);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const packagedMigrations = join(currentDirectory, "../../migrations");
const migrationsDirectory = existsSync(packagedMigrations) ? packagedMigrations : join(process.cwd(), "migrations");

try {
  await pool.query("SELECT pg_advisory_lock(hashtext('metricops_schema_migrations'))");
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const migrations = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const version of migrations) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
    if (applied.rowCount) continue;
    const sql = await readFile(join(migrationsDirectory, version), "utf8");
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING", [version]);
    console.info(`Applied migration ${version}`);
  }
} finally {
  await pool.query("SELECT pg_advisory_unlock(hashtext('metricops_schema_migrations'))").catch(() => undefined);
  await pool.end();
}
