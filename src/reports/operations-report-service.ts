import type pg from "pg";
import type { AuditService } from "../audit/audit-service.js";
import { withTenantTransaction } from "../database/transaction.js";
import type { Principal } from "../domain/principal.js";

export class OperationsReportService {
  constructor(private readonly pool: pg.Pool, private readonly audit: AuditService) {}

  async generate(principal: Principal, start: Date, end: Date, requestId: string) {
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const alerts = await client.query<{ severity: string; status: string; count: string }>(
        `SELECT severity,status,count(*)::text AS count FROM alert_instances
         WHERE customer_id=$1 AND starts_at >= $2 AND starts_at < $3
         GROUP BY severity,status ORDER BY severity,status`,
        [principal.customerId, start, end],
      );
      const incidents = await client.query<{ severity: string; status: string; count: string }>(
        `SELECT severity,status,count(*)::text AS count FROM incidents
         WHERE customer_id=$1 AND detected_at >= $2 AND detected_at < $3
         GROUP BY severity,status ORDER BY severity,status`,
        [principal.customerId, start, end],
      );
      const timing = await client.query<{ acknowledged_count: string; resolved_count: string; mean_time_to_ack_seconds: string | null; mean_time_to_resolve_seconds: string | null }>(
        `SELECT count(acknowledged_at)::text AS acknowledged_count,count(resolved_at)::text AS resolved_count,
                extract(epoch FROM avg(acknowledged_at-detected_at))::text AS mean_time_to_ack_seconds,
                extract(epoch FROM avg(resolved_at-detected_at))::text AS mean_time_to_resolve_seconds
         FROM incidents WHERE customer_id=$1 AND detected_at >= $2 AND detected_at < $3`,
        [principal.customerId, start, end],
      );
      const active = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM incidents WHERE customer_id=$1 AND status NOT IN ('resolved','closed')",
        [principal.customerId],
      );
      const timingRow = timing.rows[0]!;
      const report = {
        period: { start: start.toISOString(), end: end.toISOString() },
        alerts: alerts.rows.map((row) => ({ severity: row.severity, status: row.status, count: Number(row.count) })),
        incidents: incidents.rows.map((row) => ({ severity: row.severity, status: row.status, count: Number(row.count) })),
        serviceLevels: {
          acknowledgedCount: Number(timingRow.acknowledged_count), resolvedCount: Number(timingRow.resolved_count),
          meanTimeToAcknowledgeSeconds: nullableNumber(timingRow.mean_time_to_ack_seconds),
          meanTimeToResolveSeconds: nullableNumber(timingRow.mean_time_to_resolve_seconds),
        },
        currentlyActiveIncidents: Number(active.rows[0]!.count),
      };
      await this.audit.append(client, { customerId: principal.customerId, actorId: principal.subject, action: "operations_report.generated", resourceType: "report", resourceId: `${report.period.start}/${report.period.end}`, requestId, details: { start: report.period.start, end: report.period.end } });
      return report;
    });
  }
}

function nullableNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 1000) / 1000 : null;
}
