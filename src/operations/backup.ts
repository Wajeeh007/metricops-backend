import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { encryptFile, fileSha256, readBackupKey } from "./backup-crypto.js";
import { postgresCommandEnvironment, runPostgresCommand } from "./postgres-command.js";

const backupDirectory = requiredAbsolute("BACKUP_DIRECTORY");
const databaseUrlFile = requiredAbsolute("BACKUP_DATABASE_URL_FILE");
const keyFile = requiredAbsolute("BACKUP_ENCRYPTION_KEY_FILE");
const temporaryRoot = requiredAbsolute("BACKUP_TEMP_DIRECTORY");
const caFile = process.env.DATABASE_CA_FILE;
if (caFile && !caFile.startsWith("/")) throw new Error("DATABASE_CA_FILE must be absolute");

await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
const directoryMetadata = await lstat(backupDirectory);
if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink() || (directoryMetadata.mode & 0o077) !== 0) throw new Error("Backup directory must be a mode 0700 directory and not a symbolic link");
const temporaryRootMetadata = await lstat(temporaryRoot);
if (!temporaryRootMetadata.isDirectory() || temporaryRootMetadata.isSymbolicLink() || (temporaryRootMetadata.mode & 0o077) !== 0) throw new Error("Backup temporary directory must be a mode 0700 tmpfs directory and not a symbolic link");

const temporaryDirectory = await mkdtemp(join(temporaryRoot, "metricops-backup-"));
const rawDump = join(temporaryDirectory, "database.dump");
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const basename = `metricops-${timestamp}-${randomUUID()}`;
const partialBackup = join(backupDirectory, `.${basename}.dump.enc.partial`);
const finalBackup = join(backupDirectory, `${basename}.dump.enc`);
const partialManifest = join(backupDirectory, `.${basename}.manifest.json.partial`);
const finalManifest = join(backupDirectory, `${basename}.manifest.json`);
const pg = await postgresCommandEnvironment(databaseUrlFile, process.env.DATABASE_SSL_MODE || "verify-full", caFile);

try {
  await runPostgresCommand("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--compress=6"], pg.env, rawDump);
  await runPostgresCommand("pg_restore", ["--list", rawDump], pg.env);
  const key = await readBackupKey(keyFile);
  await encryptFile(rawDump, partialBackup, key);
  const sha256 = await fileSha256(partialBackup);
  const size = (await stat(partialBackup)).size;
  await writeFile(partialManifest, `${JSON.stringify({
    format: "metricops-encrypted-postgresql-backup-v1",
    createdAt: new Date().toISOString(),
    database: pg.database,
    encryption: "aes-256-gcm+scrypt",
    sha256,
    bytes: size,
    backupFile: `${basename}.dump.enc`,
  }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(partialBackup, finalBackup);
  await rename(partialManifest, finalManifest);
  console.info(JSON.stringify({ level: "info", event: "backup_created", backup: finalBackup, manifest: finalManifest, bytes: size, sha256 }));
} catch (error) {
  await rm(partialBackup, { force: true }).catch(() => undefined);
  await rm(partialManifest, { force: true }).catch(() => undefined);
  throw error;
} finally {
  await pg.cleanup();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function requiredAbsolute(name: string): string {
  const value = process.env[name];
  if (!value || !value.startsWith("/")) throw new Error(`${name} must be an absolute path`);
  return resolve(value);
}
