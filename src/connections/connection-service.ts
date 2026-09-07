import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { AuditService } from "../audit/audit-service.js";
import { conflict, notFound } from "../domain/errors.js";
import type { Principal } from "../domain/principal.js";
import { withTenantTransaction } from "../database/transaction.js";
import type { ConnectorRegistry } from "./connector-registry.js";
import type { ConnectionConfiguration, ConnectionKind, ConnectionRecord } from "./types.js";

export interface CreateConnectionInput {
  readonly name: string;
  readonly kind: ConnectionKind;
  readonly configuration: ConnectionConfiguration;
  readonly secretRef: string | null;
}

export interface ConnectionView {
  readonly id: string;
  readonly name: string;
  readonly kind: ConnectionKind;
  readonly configuration: ConnectionConfiguration;
  readonly status: ConnectionRecord["status"];
  readonly lastValidatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toView(record: ConnectionRecord): ConnectionView {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    configuration: record.configuration,
    status: record.status,
    lastValidatedAt: record.lastValidatedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapRecord(row: Record<string, unknown>): ConnectionRecord {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    name: String(row.name),
    kind: row.kind as ConnectionKind,
    configuration: row.configuration as ConnectionConfiguration,
    secretRef: row.secret_ref === null ? null : String(row.secret_ref),
    status: row.status as ConnectionRecord["status"],
    lastValidatedAt: row.last_validated_at instanceof Date ? row.last_validated_at : null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export class ConnectionService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly audit: AuditService,
    private readonly connectors: ConnectorRegistry,
  ) {}

  async list(principal: Principal, limit: number): Promise<readonly ConnectionView[]> {
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const result = await client.query(
        `SELECT id, customer_id, name, kind, configuration, secret_ref, status, last_validated_at, created_at, updated_at
         FROM connections WHERE customer_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
        [principal.customerId, limit],
      );
      return result.rows.map((row) => toView(mapRecord(row)));
    });
  }

  async create(principal: Principal, input: CreateConnectionInput, idempotencyKey: string, requestId: string): Promise<ConnectionView> {
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const prior = await client.query<{ request_hash: string; response_body: ConnectionView }>(
        `SELECT request_hash, response_body FROM idempotency_records
         WHERE customer_id = $1 AND operation = 'connection.create' AND idempotency_key = $2 AND expires_at > now()`,
        [principal.customerId, idempotencyKey],
      );
      const priorRecord = prior.rows[0];
      if (priorRecord) {
        if (priorRecord.request_hash !== requestHash) {
          throw conflict("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for a different request");
        }
        return priorRecord.response_body;
      }
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO connections (id, customer_id, name, kind, configuration, secret_ref, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, customer_id, name, kind, configuration, secret_ref, status, last_validated_at, created_at, updated_at`,
        [id, principal.customerId, input.name, input.kind, input.configuration, input.secretRef, principal.subject],
      );
      const view = toView(mapRecord(inserted.rows[0] as Record<string, unknown>));
      await this.audit.append(client, {
        customerId: principal.customerId,
        actorId: principal.subject,
        action: "connection.created",
        resourceType: "connection",
        resourceId: id,
        requestId,
        details: { kind: input.kind, name: input.name },
      });
      await client.query(
        `INSERT INTO idempotency_records
         (customer_id, operation, idempotency_key, request_hash, response_status, response_body, expires_at)
         VALUES ($1, 'connection.create', $2, $3, 201, $4, now() + interval '24 hours')`,
        [principal.customerId, idempotencyKey, requestHash, view],
      );
      return view;
    });
  }

  async validate(principal: Principal, connectionId: string, requestId: string) {
    const record = await withTenantTransaction<ConnectionRecord>(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const result = await client.query(
        `SELECT id, customer_id, name, kind, configuration, secret_ref, status, last_validated_at, created_at, updated_at
         FROM connections WHERE customer_id = $1 AND id = $2`,
        [principal.customerId, connectionId],
      );
      if (!result.rows[0]) throw notFound("Connection");
      return mapRecord(result.rows[0]);
    });
    const check = await this.connectors.get(record.kind).validate(record);
    await withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      await client.query(
        `UPDATE connections SET status = $1, last_validated_at = $2, updated_at = now()
         WHERE customer_id = $3 AND id = $4`,
        [check.healthy ? "healthy" : "unhealthy", check.checkedAt, principal.customerId, connectionId],
      );
      await this.audit.append(client, {
        customerId: principal.customerId,
        actorId: principal.subject,
        action: "connection.validated",
        resourceType: "connection",
        resourceId: connectionId,
        requestId,
        details: { healthy: check.healthy, latencyMs: check.latencyMs, errorCode: check.errorCode ?? null },
      });
    });
    return {
      connectionId,
      healthy: check.healthy,
      checkedAt: check.checkedAt.toISOString(),
      latencyMs: check.latencyMs,
      metadata: check.metadata,
      ...(check.errorCode ? { errorCode: check.errorCode } : {}),
    };
  }
}
