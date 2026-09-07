import { createHmac, randomUUID } from "node:crypto";
import type pg from "pg";

export interface AuditInput {
  readonly customerId: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly requestId: string;
  readonly occurredAt?: Date;
  readonly details?: Readonly<Record<string, unknown>>;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export interface StoredAuditEvent {
  readonly sequence: number;
  readonly id: string;
  readonly customerId: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly requestId: string;
  readonly occurredAt: Date;
  readonly details: Readonly<Record<string, unknown>>;
  readonly previousHash: string | null;
  readonly chainHash: string;
}

export interface AuditAnchor { readonly customerId: string; readonly sequence: number; readonly chainHash: string }

export function verifyAuditEvents(events: readonly StoredAuditEvent[], hmacKey: string, initial: readonly AuditAnchor[] = []): readonly AuditAnchor[] {
  const heads = new Map(initial.map((anchor) => [anchor.customerId, anchor]));
  for (const event of events) {
    const previous = heads.get(event.customerId);
    if ((previous?.chainHash ?? null) !== event.previousHash) throw new Error("Audit chain linkage verification failed");
    const body = canonicalJson({
      id: event.id,
      customerId: event.customerId,
      actorId: event.actorId,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      requestId: event.requestId,
      occurredAt: event.occurredAt.toISOString(),
      details: event.details,
      previousHash: event.previousHash,
    });
    const expected = createHmac("sha256", hmacKey).update(body).digest("hex");
    if (expected !== event.chainHash) throw new Error("Audit chain digest verification failed");
    heads.set(event.customerId, { customerId: event.customerId, sequence: event.sequence, chainHash: event.chainHash });
  }
  return [...heads.values()].sort((left, right) => left.customerId.localeCompare(right.customerId));
}

export class AuditService {
  constructor(private readonly hmacKey: string) {}

  async append(client: pg.PoolClient, input: AuditInput): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.customerId]);
    const previous = await client.query<{ chain_hash: string }>(
      "SELECT chain_hash FROM audit_events WHERE customer_id = $1 ORDER BY sequence DESC LIMIT 1",
      [input.customerId],
    );
    const id = randomUUID();
    const occurredAt = input.occurredAt ?? new Date();
    const details = input.details ?? {};
    const previousHash = previous.rows[0]?.chain_hash ?? null;
    const body = canonicalJson({
      id,
      customerId: input.customerId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestId: input.requestId,
      occurredAt: occurredAt.toISOString(),
      details,
      previousHash,
    });
    const chainHash = createHmac("sha256", this.hmacKey).update(body).digest("hex");
    await client.query(
      `INSERT INTO audit_events
       (id, customer_id, actor_id, action, resource_type, resource_id, request_id, occurred_at, details, previous_hash, chain_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, input.customerId, input.actorId, input.action, input.resourceType, input.resourceId, input.requestId, occurredAt, details, previousHash, chainHash],
    );
  }
}
