import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertManifestHash, decryptFile, readBackupKey } from "./backup-crypto.js";
import { postgresCommandEnvironment, runPostgresCommand } from "./postgres-command.js";

const backupFile = requiredAbsolute("RESTORE_BACKUP_FILE");
const manifestFile = requiredAbsolute("RESTORE_MANIFEST_FILE");
const keyFile = requiredAbsolute("BACKUP_ENCRYPTION_KEY_FILE");
const adminUrlFile = requiredAbsolute("RESTORE_ADMIN_DATABASE_URL_FILE");
const temporaryRoot = requiredAbsolute("BACKUP_TEMP_DIRECTORY");
const target = process.env.RESTORE_DATABASE_NAME;
if (!target || !/^[a-z][a-z0-9_]{2,62}_restore_test$/.test(target)) throw new Error("RESTORE_DATABASE_NAME must be a lowercase name ending in _restore_test");
for (const path of [backupFile, manifestFile]) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o022) !== 0) throw new Error("Backup artifacts must be regular files not writable by group or world");
}

const temporaryRootMetadata = await lstat(temporaryRoot);
if (!temporaryRootMetadata.isDirectory() || temporaryRootMetadata.isSymbolicLink() || (temporaryRootMetadata.mode & 0o077) !== 0) throw new Error("Backup temporary directory must be a mode 0700 tmpfs directory and not a symbolic link");
await assertManifestHash(backupFile, manifestFile);
const key = await readBackupKey(keyFile);
const temporaryDirectory = await mkdtemp(join(temporaryRoot, "metricops-restore-"));
const rawDump = join(temporaryDirectory, "database.dump");
const verificationOutput = join(temporaryDirectory, "verification.txt");
const caFile = process.env.DATABASE_CA_FILE;
const pg = await postgresCommandEnvironment(adminUrlFile, process.env.DATABASE_SSL_MODE || "verify-full", caFile);
let created = false;
let succeeded = false;
try {
  await decryptFile(backupFile, rawDump, key);
  await runPostgresCommand("pg_restore", ["--list", rawDump], pg.env);
  await runPostgresCommand("createdb", ["--maintenance-db=postgres", target], pg.env);
  created = true;
  await runPostgresCommand("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--dbname", target, rawDump], pg.env);
  await runPostgresCommand("psql", [
    "--dbname", target, "--no-align", "--tuples-only", "--set", "ON_ERROR_STOP=1",
    "--command", "SELECT (to_regclass('public.schema_migrations') IS NOT NULL)::int || ':' || (to_regclass('public.customers') IS NOT NULL)::int",
  ], pg.env, verificationOutput);
  const verification = (await readFile(verificationOutput, "utf8")).trim();
  if (verification !== "1:1") throw new Error("Restored database did not pass structural verification");
  succeeded = true;
  console.info(JSON.stringify({ level: "info", event: "restore_drill_succeeded", database: target, backup: backupFile }));
} finally {
  if (created && process.env.KEEP_RESTORE_DATABASE !== "true") {
    await runPostgresCommand("dropdb", ["--maintenance-db=postgres", "--if-exists", target], pg.env).catch(() => undefined);
  }
  await pg.cleanup();
  await rm(temporaryDirectory, { recursive: true, force: true });
  if (!succeeded) console.error(JSON.stringify({ level: "error", event: "restore_drill_failed", database: target }));
}

function requiredAbsolute(name: string): string {
  const value = process.env[name];
  if (!value || !value.startsWith("/")) throw new Error(`${name} must be an absolute path`);
  return value;
}
