import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import type { AuditService } from "../audit/audit-service.js";
import { conflict, invalid, notFound } from "../domain/errors.js";
import type { Principal } from "../domain/principal.js";
import { withTenantTransaction } from "../database/transaction.js";

export interface CreateResourceInput {
  readonly providerId: string;
  readonly resourceType: "linux_host" | "application_endpoint" | "database_instance" | "aws_ec2" | "aws_ebs" | "aws_rds" | "aws_load_balancer";
  readonly name: string;
  readonly environment: string;
  readonly criticality: "low" | "medium" | "high" | "critical";
  readonly dataClassification: "public" | "internal" | "confidential" | "restricted";
  readonly monitoringConnectionId: string | null;
  readonly monitoringSelector: string | null;
  readonly tags: Readonly<Record<string, string>>;
  readonly source: string;
}

export interface ResourceView extends CreateResourceInput {
  readonly id: string;
  readonly lastDiscoveredAt: string | null;
  readonly lastTelemetryAt: string | null;
  readonly version: number;
  readonly discoveryState: "active" | "missing";
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Cursor { readonly createdAt: string; readonly id: string }

const columns = "id, provider_id, resource_type, name, environment, criticality, data_classification, monitoring_connection_id, monitoring_selector, tags, source, last_discovered_at, last_telemetry_at, discovery_state, version, created_at, updated_at";

function toView(row: Record<string, unknown>): ResourceView {
  return {
    id: String(row.id), providerId: String(row.provider_id), resourceType: row.resource_type as ResourceView["resourceType"],
    name: String(row.name), environment: String(row.environment), criticality: row.criticality as ResourceView["criticality"],
    dataClassification: row.data_classification as ResourceView["dataClassification"],
    monitoringConnectionId: row.monitoring_connection_id === null ? null : String(row.monitoring_connection_id),
    monitoringSelector: row.monitoring_selector === null ? null : String(row.monitoring_selector),
    tags: row.tags as Readonly<Record<string, string>>, source: String(row.source),
    lastDiscoveredAt: row.last_discovered_at instanceof Date ? row.last_discovered_at.toISOString() : null,
    lastTelemetryAt: row.last_telemetry_at instanceof Date ? row.last_telemetry_at.toISOString() : null,
    discoveryState: row.discovery_state as ResourceView["discoveryState"], version: Number(row.version), createdAt: (row.created_at as Date).toISOString(), updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export class ResourceService {
  private readonly cursorKey: Buffer;
  constructor(private readonly pool: pg.Pool, private readonly audit: AuditService, key: string) {
    this.cursorKey = createHmac("sha256", key).update("metricops.resource.cursor.v1").digest();
  }

  async create(principal: Principal, input: CreateResourceInput, idempotencyKey: string, requestId: string): Promise<ResourceView> {
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const prior = await client.query<{ request_hash: string; response_body: ResourceView }>(
        "SELECT request_hash, response_body FROM idempotency_records WHERE customer_id=$1 AND operation='resource.create' AND idempotency_key=$2 AND expires_at>now()",
        [principal.customerId, idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash) throw conflict("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for a different request");
        return prior.rows[0].response_body;
      }
      if (input.monitoringConnectionId) {
        const connection = await client.query("SELECT 1 FROM connections WHERE customer_id=$1 AND id=$2 AND kind='prometheus' AND status<>'disabled'", [principal.customerId, input.monitoringConnectionId]);
        if (!connection.rowCount) throw invalid("INVALID_MONITORING_CONNECTION", "The monitoring connection is unavailable or incompatible");
      }
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO resources
         (id,customer_id,provider_id,resource_type,name,environment,criticality,data_classification,monitoring_connection_id,monitoring_selector,tags,source,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${columns}`,
        [id, principal.customerId, input.providerId, input.resourceType, input.name, input.environment, input.criticality, input.dataClassification, input.monitoringConnectionId, input.monitoringSelector, input.tags, input.source, principal.subject],
      );
      const view = toView(inserted.rows[0]);
      await this.audit.append(client, { customerId: principal.customerId, actorId: principal.subject, action: "resource.created", resourceType: "resource", resourceId: id, requestId, details: { resourceType: input.resourceType, source: input.source } });
      await client.query(
        "INSERT INTO idempotency_records(customer_id,operation,idempotency_key,request_hash,response_status,response_body,expires_at) VALUES($1,'resource.create',$2,$3,201,$4,now()+interval '24 hours')",
        [principal.customerId, idempotencyKey, requestHash, view],
      );
      return view;
    });
  }

  async list(principal: Principal, limit: number, cursorText?: string) {
    const cursor = cursorText ? this.decodeCursor(cursorText) : null;
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const result = await client.query(
        `SELECT ${columns} FROM resources WHERE customer_id=$1
         AND ($2::timestamptz IS NULL OR (created_at,id) < ($2::timestamptz,$3::uuid))
         ORDER BY created_at DESC,id DESC LIMIT $4`,
        [principal.customerId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
      );
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      return { data: rows.map(toView), nextCursor: result.rows.length > limit && last ? this.encodeCursor({ createdAt: (last.created_at as Date).toISOString(), id: String(last.id) }) : null };
    });
  }

  private encodeCursor(cursor: Cursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
    const signature = createHmac("sha256", this.cursorKey).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  private decodeCursor(value: string): Cursor {
    if (value.length > 500) throw invalid("INVALID_CURSOR", "The pagination cursor is invalid");
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra) throw invalid("INVALID_CURSOR", "The pagination cursor is invalid");
    const expected = createHmac("sha256", this.cursorKey).update(payload).digest();
    let supplied: Buffer;
    try { supplied = Buffer.from(signature, "base64url"); }
    catch { throw invalid("INVALID_CURSOR", "The pagination cursor is invalid"); }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalid("INVALID_CURSOR", "The pagination cursor is invalid");
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
      if (typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt)) || typeof parsed.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) throw new Error();
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch { throw invalid("INVALID_CURSOR", "The pagination cursor is invalid"); }
  }
}
