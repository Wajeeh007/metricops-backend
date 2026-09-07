import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { verifyAuditEvents, type AuditAnchor, type StoredAuditEvent } from "../audit/audit-service.js";

const databaseUrlFile = requiredAbsolute("AUDIT_DATABASE_URL_FILE");
const hmacKeyFile = requiredAbsolute("AUDIT_HMAC_KEY_FILE");
const expectedAnchorFile = process.env.AUDIT_EXPECTED_ANCHOR_FILE ? resolve(process.env.AUDIT_EXPECTED_ANCHOR_FILE) : null;
const databaseUrl = (await readProtected(databaseUrlFile, true)).trim();
const hmacKey = (await readProtected(hmacKeyFile, true)).trim();
if (!/^postgres(?:ql)?:$/.test(new URL(databaseUrl).protocol)) throw new Error("Audit database URL is invalid");
if (hmacKey.length < 32) throw new Error("Audit HMAC key must contain at least 32 characters");

const sslMode = process.env.DATABASE_SSL_MODE || "verify-full";
if (!/^(disable|require|verify-full)$/.test(sslMode)) throw new Error("DATABASE_SSL_MODE is invalid");
const ca = process.env.DATABASE_CA_FILE ? await readProtected(resolve(process.env.DATABASE_CA_FILE), false) : undefined;
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  ssl: sslMode === "disable" ? false : { rejectUnauthorized: sslMode === "verify-full", minVersion: "TLSv1.2", ...(ca ? { ca } : {}) },
});

try {
  const expected = expectedAnchorFile ? parseExpectedAnchors(await readProtected(expectedAnchorFile, false)) : [];
  const expectedByPosition = new Map(expected.map((anchor) => [`${anchor.customerId}:${anchor.sequence}`, anchor.chainHash]));
  let anchors: readonly AuditAnchor[] = [];
  let afterSequence = 0;
  let eventCount = 0;
  while (true) {
    const page = await pool.query<Record<string, unknown>>(`SELECT sequence,id,customer_id,actor_id,action,resource_type,
      resource_id,request_id,occurred_at,details,previous_hash,chain_hash
      FROM audit_events WHERE sequence > $1 ORDER BY sequence LIMIT 10000`, [afterSequence]);
    if (!page.rows.length) break;
    const events = page.rows.map(mapEvent);
    for (const event of events) {
      const position = `${event.customerId}:${event.sequence}`;
      const expectedHash = expectedByPosition.get(position);
      if (expectedHash !== undefined) {
        if (expectedHash !== event.chainHash) throw new Error("Expected audit anchor does not match; possible audit tampering");
        expectedByPosition.delete(position);
      }
    }
    anchors = verifyAuditEvents(events, hmacKey, anchors);
    eventCount += events.length;
    afterSequence = events.at(-1)!.sequence;
  }
  if (expectedByPosition.size) throw new Error("Expected audit anchor was not found; possible audit truncation");
  console.info(JSON.stringify({ version: 1, verifiedAt: new Date().toISOString(), eventCount, anchors }, null, 2));
} finally {
  await pool.end();
}

function mapEvent(row: Record<string, unknown>): StoredAuditEvent {
  return {
    sequence: Number(row.sequence), id: String(row.id), customerId: String(row.customer_id), actorId: String(row.actor_id),
    action: String(row.action), resourceType: String(row.resource_type), resourceId: String(row.resource_id), requestId: String(row.request_id),
    occurredAt: row.occurred_at as Date, details: row.details as Record<string, unknown>,
    previousHash: row.previous_hash === null ? null : String(row.previous_hash), chainHash: String(row.chain_hash),
  };
}

function parseExpectedAnchors(raw: string): readonly AuditAnchor[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Expected audit anchor file is malformed"); }
  if (!parsed || typeof parsed !== "object" || !("anchors" in parsed) || !Array.isArray(parsed.anchors)) throw new Error("Expected audit anchor file is malformed");
  const anchors: AuditAnchor[] = [];
  for (const anchor of parsed.anchors as unknown[]) {
    if (!anchor || typeof anchor !== "object") throw new Error("Expected audit anchor file is malformed");
    const value = anchor as Record<string, unknown>;
    if (typeof value.customerId !== "string" || typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || typeof value.chainHash !== "string" || !/^[a-f0-9]{64}$/.test(value.chainHash)) throw new Error("Expected audit anchor file is malformed");
    anchors.push({ customerId: value.customerId, sequence: value.sequence, chainHash: value.chainHash });
  }
  return anchors;
}

async function readProtected(path: string, sensitive: boolean): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & (sensitive ? 0o077 : 0o022)) !== 0) throw new Error("Protected file permissions are unsafe");
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}

function requiredAbsolute(name: string): string {
  const value = process.env[name];
  if (!value || !value.startsWith("/")) throw new Error(`${name} must be an absolute path`);
  return resolve(value);
}
