import type pg from "pg";
import type { AuditService } from "../audit/audit-service.js";
import type { ConnectionRecord, PrometheusConnectionConfiguration } from "../connections/types.js";
import { PrometheusConnector } from "../connections/prometheus-connector.js";
import { AppError, invalid, notFound } from "../domain/errors.js";
import type { Principal } from "../domain/principal.js";
import { withTenantTransaction } from "../database/transaction.js";

export interface MetricsQueryInput {
  readonly resourceId: string;
  readonly queryId: "host.up" | "host.cpu.utilization" | "host.memory.utilization";
  readonly start: string;
  readonly end: string;
  readonly stepSeconds: number;
}

const templates: Record<MetricsQueryInput["queryId"], (selector: string) => string> = {
  "host.up": (selector) => `up{instance="${selector}"}`,
  "host.cpu.utilization": (selector) => `100-(avg by(instance)(rate(node_cpu_seconds_total{mode="idle",instance="${selector}"}[5m]))*100)`,
  "host.memory.utilization": (selector) => `(1-(node_memory_MemAvailable_bytes{instance="${selector}"}/node_memory_MemTotal_bytes{instance="${selector}"}))*100`,
};

export class MetricsService {
  private readonly activeByCustomer = new Map<string, number>();
  constructor(private readonly pool: pg.Pool, private readonly audit: AuditService, private readonly prometheus: PrometheusConnector) {}

  async query(principal: Principal, input: MetricsQueryInput, requestId: string) {
    const active = this.activeByCustomer.get(principal.customerId) ?? 0;
    if (active >= 4) throw new AppError(429, "METRICS_CONCURRENCY_LIMIT", "Too many metrics queries are active for this customer");
    this.activeByCustomer.set(principal.customerId, active + 1);
    try { return await this.execute(principal, input, requestId); }
    finally {
      const remaining = (this.activeByCustomer.get(principal.customerId) ?? 1) - 1;
      if (remaining <= 0) this.activeByCustomer.delete(principal.customerId);
      else this.activeByCustomer.set(principal.customerId, remaining);
    }
  }

  private async execute(principal: Principal, input: MetricsQueryInput, requestId: string) {
    const target = await withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const found = await client.query(
        `SELECT r.resource_type,r.monitoring_selector,
                c.id,c.customer_id,c.name,c.kind,c.configuration,c.secret_ref,c.status,c.last_validated_at,c.created_at,c.updated_at
         FROM resources r LEFT JOIN connections c ON c.customer_id=r.customer_id AND c.id=r.monitoring_connection_id
         WHERE r.customer_id=$1 AND r.id=$2`, [principal.customerId, input.resourceId],
      );
      const row = found.rows[0];
      if (!row) throw notFound("Resource");
      if (row.resource_type !== "linux_host") throw invalid("UNSUPPORTED_METRIC_TEMPLATE", "The metric template does not support this resource type");
      if (row.kind !== "prometheus" || row.status === "disabled" || typeof row.monitoring_selector !== "string") throw invalid("METRICS_CONNECTION_UNAVAILABLE", "The resource does not have an available Prometheus connection");
      if (!/^[A-Za-z0-9._:-]{1,253}$/.test(row.monitoring_selector)) throw new AppError(500, "INVALID_STORED_SELECTOR", "Stored resource monitoring configuration is invalid");
      await this.audit.append(client, { customerId: principal.customerId, actorId: principal.subject, action: "metrics.query.requested", resourceType: "resource", resourceId: input.resourceId, requestId, details: { queryId: input.queryId, start: input.start, end: input.end, stepSeconds: input.stepSeconds } });
      const connection: ConnectionRecord = {
        id: String(row.id), customerId: String(row.customer_id), name: String(row.name), kind: "prometheus",
        configuration: row.configuration as PrometheusConnectionConfiguration, secretRef: row.secret_ref === null ? null : String(row.secret_ref),
        status: row.status, lastValidatedAt: row.last_validated_at instanceof Date ? row.last_validated_at : null,
        createdAt: row.created_at, updatedAt: row.updated_at,
      };
      return { connection, selector: row.monitoring_selector as string };
    });
    const start = new Date(input.start);
    const end = new Date(input.end);
    let series;
    try { series = await this.prometheus.queryRange(target.connection, templates[input.queryId](target.selector), start, end, input.stepSeconds); }
    catch { throw new AppError(424, "METRICS_UPSTREAM_FAILED", "The metrics backend could not complete the bounded query"); }
    const timestamps = series.flatMap((item) => item.values.map((sample) => sample.timestamp));
    const latest = timestamps.length ? Math.max(...timestamps) : null;
    const dataState = latest === null ? "no_data" : latest < end.getTime() / 1000 - input.stepSeconds * 2 ? "stale" : "available";
    return { resourceId: input.resourceId, queryId: input.queryId, start: input.start, end: input.end, stepSeconds: input.stepSeconds, dataState, series };
  }
}
