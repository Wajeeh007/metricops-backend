import { randomUUID } from "node:crypto";
import type pg from "pg";
import { ZodError } from "zod";
import type { AuditService } from "../audit/audit-service.js";
import { conflict, invalid, unauthorized } from "../domain/errors.js";
import { withTenantTransaction } from "../database/transaction.js";
import { alertmanagerWebhookSchema, uuidSchema } from "../http/schemas.js";
import type { FileSecretProvider } from "../secrets/file-secret-provider.js";
import { parseWebhookEnvelope, verifyWebhookSignature } from "./webhook-signature.js";

export class AlertmanagerService {
  constructor(private readonly pool: pg.Pool, private readonly audit: AuditService, private readonly secrets: FileSecretProvider) {}

  async ingest(customerId: string, connectionId: string, headers: Readonly<Record<string, string | undefined>>, body: Buffer, requestId: string) {
    const envelope = parseWebhookEnvelope(headers);
    const connection = await withTenantTransaction(this.pool, { customerId, actorId: "alertmanager-webhook" }, async (client) => {
      const result = await client.query<{ secret_ref: string }>("SELECT secret_ref FROM connections WHERE customer_id=$1 AND id=$2 AND kind='alertmanager_webhook' AND status<>'disabled'", [customerId, connectionId]);
      if (!result.rows[0]?.secret_ref) throw unauthorized();
      return result.rows[0];
    });
    let key: string;
    try { key = (await this.secrets.getWebhookSecret(connection.secret_ref)).hmacKey; }
    catch { throw unauthorized(); }
    verifyWebhookSignature(envelope, body, key);
    let payload: ReturnType<typeof alertmanagerWebhookSchema.parse>;
    try { payload = alertmanagerWebhookSchema.parse(JSON.parse(body.toString("utf8"))); }
    catch (error) {
      if (error instanceof ZodError) throw error;
      throw invalid("INVALID_WEBHOOK_PAYLOAD", "The webhook payload is invalid");
    }
    return withTenantTransaction(this.pool, { customerId, actorId: "alertmanager-webhook" }, async (client) => {
      const receipt = await client.query(
        "INSERT INTO webhook_receipts(customer_id,connection_id,nonce,signature_timestamp) VALUES($1,$2,$3,to_timestamp($4)) ON CONFLICT DO NOTHING",
        [customerId, connectionId, envelope.nonce, envelope.timestamp],
      );
      if (!receipt.rowCount) throw conflict("WEBHOOK_REPLAYED", "The webhook delivery was already processed");
      let incidentsCreated = 0;
      let incidentsResolved = 0;
      for (const alert of payload.alerts) {
        const startsAt = new Date(alert.startsAt);
        const endsAt = alert.endsAt ? new Date(alert.endsAt) : null;
        if (startsAt.getTime() > Date.now() + 300_000 || (endsAt && endsAt < startsAt)) throw invalid("INVALID_ALERT_TIME", "An alert contains invalid timestamps");
        const severity = normalizeSeverity(alert.labels.severity);
        const title = (alert.annotations.summary || alert.labels.alertname || "Monitoring alert").slice(0, 300);
        const summary = (alert.annotations.description || alert.annotations.summary || "").slice(0, 2000);
        const candidateResource = alert.labels.metricops_resource_id;
        let resourceId: string | null = null;
        if (candidateResource && uuidSchema.safeParse(candidateResource).success) {
          const resource = await client.query("SELECT 1 FROM resources WHERE customer_id=$1 AND id=$2", [customerId, candidateResource]);
          if (resource.rowCount) resourceId = candidateResource;
        }
        const upserted = await client.query<{ id: string }>(
          `INSERT INTO alert_instances
           (id,customer_id,connection_id,fingerprint,status,severity,title,summary,labels,resource_id,starts_at,ends_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT(customer_id,connection_id,fingerprint) DO UPDATE SET
             status=excluded.status,severity=excluded.severity,title=excluded.title,summary=excluded.summary,
             labels=excluded.labels,resource_id=coalesce(excluded.resource_id,alert_instances.resource_id),
             starts_at=excluded.starts_at,ends_at=excluded.ends_at,last_received_at=now(),updated_at=now()
           RETURNING id`,
          [randomUUID(), customerId, connectionId, alert.fingerprint, alert.status, severity, title, summary, alert.labels, resourceId, startsAt, endsAt],
        );
        const alertId = upserted.rows[0]!.id;
        await client.query(
          "INSERT INTO alert_events(id,customer_id,alert_instance_id,event_type,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), customerId, alertId, alert.status, alert.status === "resolved" ? endsAt ?? new Date() : startsAt, { severity, title }],
        );
        if (alert.status === "firing" && severity === "critical") {
          const active = await client.query("SELECT id FROM incidents WHERE customer_id=$1 AND alert_instance_id=$2 AND status NOT IN ('resolved','closed') FOR UPDATE", [customerId, alertId]);
          if (!active.rowCount) {
            const incidentId = randomUUID();
            await client.query("INSERT INTO incidents(id,customer_id,alert_instance_id,resource_id,title,severity,status,detected_at) VALUES($1,$2,$3,$4,$5,'critical','open',$6)", [incidentId, customerId, alertId, resourceId, title, startsAt]);
            await client.query("INSERT INTO incident_events(id,customer_id,incident_id,actor_id,event_type,details) VALUES($1,$2,$3,'alertmanager-webhook','created',$4)", [randomUUID(), customerId, incidentId, { alertId }]);
            incidentsCreated += 1;
          }
        }
        if (alert.status === "resolved") {
          const resolved = await client.query<{ id: string }>("UPDATE incidents SET status='resolved',resolved_at=$1,updated_at=now(),version=version+1 WHERE customer_id=$2 AND alert_instance_id=$3 AND status NOT IN ('resolved','closed') RETURNING id", [endsAt ?? new Date(), customerId, alertId]);
          for (const incident of resolved.rows) {
            await client.query("INSERT INTO incident_events(id,customer_id,incident_id,actor_id,event_type,details) VALUES($1,$2,$3,'alertmanager-webhook','resolved',$4)", [randomUUID(), customerId, incident.id, { reason: "monitoring_recovered" }]);
            incidentsResolved += 1;
          }
        }
      }
      await this.audit.append(client, { customerId, actorId: "alertmanager-webhook", action: "alertmanager.webhook.accepted", resourceType: "connection", resourceId: connectionId, requestId, details: { alerts: payload.alerts.length, incidentsCreated, incidentsResolved } });
      return { accepted: payload.alerts.length, incidentsCreated, incidentsResolved };
    });
  }
}

function normalizeSeverity(value: string | undefined): "info" | "warning" | "critical" {
  const normalized = value?.toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "warning" || normalized === "warn") return "warning";
  return "info";
}
