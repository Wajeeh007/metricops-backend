import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { AuditService } from "../audit/audit-service.js";
import { conflict, notFound } from "../domain/errors.js";
import type { Principal } from "../domain/principal.js";
import { withTenantTransaction } from "../database/transaction.js";

export class IncidentService {
  constructor(private readonly pool: pg.Pool, private readonly audit: AuditService) {}

  async listAlerts(principal: Principal, limit: number) {
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const result = await client.query(
        `SELECT id,connection_id,fingerprint,status,severity,title,summary,labels,resource_id,starts_at,ends_at,last_received_at,created_at,updated_at
         FROM alert_instances WHERE customer_id=$1 ORDER BY updated_at DESC,id DESC LIMIT $2`, [principal.customerId, limit],
      );
      return result.rows.map(camelizeAlert);
    });
  }

  async listIncidents(principal: Principal, limit: number) {
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const result = await client.query(
        `SELECT id,alert_instance_id,resource_id,title,severity,status,assignee,resolution,detected_at,acknowledged_at,resolved_at,version,created_at,updated_at
         FROM incidents WHERE customer_id=$1 ORDER BY updated_at DESC,id DESC LIMIT $2`, [principal.customerId, limit],
      );
      return result.rows.map(camelizeIncident);
    });
  }

  async acknowledge(principal: Principal, incidentId: string, version: number, assignee: string | undefined, idempotencyKey: string, requestId: string) {
    return this.transition(principal, incidentId, "acknowledge", { version, assignee: assignee ?? principal.subject }, idempotencyKey, requestId);
  }

  async resolve(principal: Principal, incidentId: string, version: number, resolution: string, idempotencyKey: string, requestId: string) {
    return this.transition(principal, incidentId, "resolve", { version, resolution }, idempotencyKey, requestId);
  }

  private async transition(principal: Principal, incidentId: string, action: "acknowledge" | "resolve", input: { version: number; assignee?: string; resolution?: string }, idempotencyKey: string, requestId: string) {
    const operation = `incident.${action}`;
    const requestHash = createHash("sha256").update(JSON.stringify({ incidentId, ...input })).digest("hex");
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const prior = await client.query<{ request_hash: string; response_body: Record<string, unknown> }>("SELECT request_hash,response_body FROM idempotency_records WHERE customer_id=$1 AND operation=$2 AND idempotency_key=$3 AND expires_at>now()", [principal.customerId, operation, idempotencyKey]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash) throw conflict("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for a different request");
        return prior.rows[0].response_body;
      }
      const current = await client.query<{ status: string; version: number }>("SELECT status,version FROM incidents WHERE customer_id=$1 AND id=$2 FOR UPDATE", [principal.customerId, incidentId]);
      if (!current.rows[0]) throw notFound("Incident");
      if (current.rows[0].version !== input.version) throw conflict("VERSION_CONFLICT", "The incident changed; reload it before retrying");
      if (action === "acknowledge" && current.rows[0].status !== "open") throw conflict("INVALID_INCIDENT_TRANSITION", "Only an open incident can be acknowledged");
      if (action === "resolve" && ["resolved", "closed"].includes(current.rows[0].status)) throw conflict("INVALID_INCIDENT_TRANSITION", "The incident is already resolved or closed");
      const updated = action === "acknowledge"
        ? await client.query(
            `UPDATE incidents SET status='acknowledged',assignee=$1,acknowledged_at=now(),updated_at=now(),version=version+1
             WHERE customer_id=$2 AND id=$3 RETURNING id,alert_instance_id,resource_id,title,severity,status,assignee,resolution,detected_at,acknowledged_at,resolved_at,version,created_at,updated_at`,
            [input.assignee, principal.customerId, incidentId],
          )
        : await client.query(
            `UPDATE incidents SET status='resolved',resolution=$1,resolved_at=now(),updated_at=now(),version=version+1
             WHERE customer_id=$2 AND id=$3 RETURNING id,alert_instance_id,resource_id,title,severity,status,assignee,resolution,detected_at,acknowledged_at,resolved_at,version,created_at,updated_at`,
            [input.resolution, principal.customerId, incidentId],
          );
      const view = camelizeIncident(updated.rows[0]);
      const eventType = action === "acknowledge" ? "acknowledged" : "resolved";
      await client.query("INSERT INTO incident_events(id,customer_id,incident_id,actor_id,event_type,details) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), principal.customerId, incidentId, principal.subject, eventType, action === "acknowledge" ? { assignee: input.assignee } : { resolution: input.resolution }]);
      await this.audit.append(client, { customerId: principal.customerId, actorId: principal.subject, action: `incident.${eventType}`, resourceType: "incident", resourceId: incidentId, requestId, details: { version: view.version } });
      await client.query("INSERT INTO idempotency_records(customer_id,operation,idempotency_key,request_hash,response_status,response_body,expires_at) VALUES($1,$2,$3,$4,200,$5,now()+interval '24 hours')", [principal.customerId, operation, idempotencyKey, requestHash, view]);
      return view;
    });
  }
}

function iso(value: unknown): string | null { return value instanceof Date ? value.toISOString() : null; }
function camelizeAlert(row: Record<string, unknown>) {
  return { id: row.id, connectionId: row.connection_id, fingerprint: row.fingerprint, status: row.status, severity: row.severity, title: row.title, summary: row.summary, labels: row.labels, resourceId: row.resource_id, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), lastReceivedAt: iso(row.last_received_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
function camelizeIncident(row: Record<string, unknown>) {
  return { id: row.id, alertInstanceId: row.alert_instance_id, resourceId: row.resource_id, title: row.title, severity: row.severity, status: row.status, assignee: row.assignee, resolution: row.resolution, detectedAt: iso(row.detected_at), acknowledgedAt: iso(row.acknowledged_at), resolvedAt: iso(row.resolved_at), version: Number(row.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
