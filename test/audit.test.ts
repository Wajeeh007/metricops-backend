import assert from "node:assert/strict";
import test from "node:test";
import { AuditService, verifyAuditEvents, type StoredAuditEvent } from "../src/audit/audit-service.js";

test("audit append chains each event with a keyed digest and no mutable operation", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  let previousHash: string | undefined;
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push(values ? { text, values } : { text });
      if (text.startsWith("SELECT chain_hash")) return { rows: previousHash ? [{ chain_hash: previousHash }] : [] };
      if (text.startsWith("INSERT INTO audit_events")) {
        previousHash = String(values?.[10]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const service = new AuditService("01234567890123456789012345678901");
  const base = {
    customerId: "11111111-1111-4111-8111-111111111111",
    actorId: "operator",
    resourceType: "connection",
    requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  };
  await service.append(client as never, { ...base, action: "connection.created", resourceId: "one", occurredAt: new Date("2026-01-01T00:00:00Z") });
  const firstHash = previousHash;
  await service.append(client as never, { ...base, action: "connection.validated", resourceId: "one", occurredAt: new Date("2026-01-01T00:00:01Z") });
  const inserts = calls.filter(({ text }) => text.startsWith("INSERT INTO audit_events"));
  assert.equal(firstHash?.length, 64);
  assert.equal(previousHash?.length, 64);
  assert.notEqual(firstHash, previousHash);
  assert.equal(inserts[0]?.values?.[9], null);
  assert.equal(inserts[1]?.values?.[9], firstHash);
  assert.equal(calls.some(({ text }) => /UPDATE|DELETE/.test(text)), false);
});

test("audit verification detects changed content and broken links", () => {
  const key = "01234567890123456789012345678901";
  const rows: StoredAuditEvent[] = [];
  let sequence = 0;
  const client = {
    async query(text: string, values?: unknown[]) {
      if (text.startsWith("SELECT chain_hash")) return { rows: rows.length ? [{ chain_hash: rows.at(-1)?.chainHash }] : [] };
      if (text.startsWith("INSERT INTO audit_events")) {
        rows.push({
          sequence: ++sequence, id: String(values?.[0]), customerId: String(values?.[1]), actorId: String(values?.[2]),
          action: String(values?.[3]), resourceType: String(values?.[4]), resourceId: String(values?.[5]), requestId: String(values?.[6]),
          occurredAt: values?.[7] as Date, details: values?.[8] as Record<string, unknown>, previousHash: values?.[9] as string | null,
          chainHash: String(values?.[10]),
        });
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const service = new AuditService(key);
  return service.append(client as never, {
    customerId: "11111111-1111-4111-8111-111111111111", actorId: "operator", action: "connection.created",
    resourceType: "connection", resourceId: "one", requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", occurredAt: new Date("2026-01-01T00:00:00Z"),
  }).then(() => {
    assert.equal(verifyAuditEvents(rows, key)[0]?.sequence, 1);
    assert.throws(() => verifyAuditEvents([{ ...rows[0]!, action: "connection.deleted" }], key), /digest/);
    assert.throws(() => verifyAuditEvents([{ ...rows[0]!, previousHash: "0".repeat(64) }], key), /linkage/);
  });
});
