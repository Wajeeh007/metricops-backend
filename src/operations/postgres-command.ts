import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export interface PostgresCommandEnvironment { readonly env: NodeJS.ProcessEnv; cleanup(): Promise<void>; readonly database: string }

export async function postgresCommandEnvironment(urlFile: string, sslMode = "verify-full", caFile?: string): Promise<PostgresCommandEnvironment> {
  if (!urlFile.startsWith("/")) throw new Error("Database URL file path must be absolute");
  const handle = await open(urlFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  let rawUrl: string;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("Database URL file must be a mode 0600 regular file");
    rawUrl = await handle.readFile("utf8");
  } finally { await handle.close(); }
  const url = new URL(rawUrl.trim());
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1)) throw new Error("Backup database URL is invalid");
  const directory = await mkdtemp(join(tmpdir(), "metricops-pgpass-"));
  const passwordFile = join(directory, "pgpass");
  const port = url.searchParams.get("port") || url.port || "5432";
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Database port is invalid");
  const host = url.searchParams.get("host") || url.hostname;
  if (host.includes("\0") || (host.startsWith("/") && !host.startsWith("/tmp/") && !host.startsWith("/run/postgresql/") && !host.startsWith("/var/run/postgresql/"))) throw new Error("Database host is invalid");
  const database = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const escape = (value: string) => value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
  await writeFile(passwordFile, `*:${escape(port)}:*:${escape(username)}:${escape(password)}\n`, { mode: 0o600 });
  return {
    database,
    env: {
      PATH: process.env.PATH,
      PGHOST: host,
      PGPORT: port,
      PGDATABASE: database,
      PGUSER: username,
      PGPASSFILE: passwordFile,
      PGSSLMODE: sslMode,
      ...(caFile ? { PGSSLROOTCERT: caFile } : {}),
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

export async function runPostgresCommand(command: string, args: readonly string[], env: NodeJS.ProcessEnv, stdoutFile?: string, timeoutMs = 900_000): Promise<string> {
  if (!/^(?:pg_dump|pg_restore|psql|createdb|dropdb)$/.test(command)) throw new Error("Unsupported PostgreSQL operation");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 86_400_000) throw new Error("PostgreSQL operation timeout is invalid");
  const child = spawn(command, [...args], { env, stdio: ["ignore", stdoutFile ? "pipe" : "ignore", "pipe"] });
  if (!child.stderr || (stdoutFile && !child.stdout)) throw new Error(`Unable to capture ${command} subprocess streams`);
  const errors: Buffer[] = [];
  let errorBytes = 0;
  child.stderr.on("data", (chunk: Buffer) => { if (errorBytes < 16_384) errors.push(chunk.subarray(0, 16_384 - errorBytes)); errorBytes += chunk.length; });
  let timedOut = false;
  let forceTimer: NodeJS.Timeout | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    forceTimer.unref();
  }, timeoutMs);
  timeout.unref();
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timeout); if (forceTimer) clearTimeout(forceTimer); resolve(code); });
  });
  const copied = stdoutFile ? pipeline(child.stdout!, createWriteStream(stdoutFile, { flags: "wx", mode: 0o600 })) : Promise.resolve();
  const [code] = await Promise.all([exited, copied]);
  if (timedOut) throw new Error(`${command} exceeded its execution timeout`);
  if (code !== 0) throw new Error(`${command} failed: ${Buffer.concat(errors).toString("utf8").slice(0, 1000)}`);
  return Buffer.concat(errors).toString("utf8");
}
