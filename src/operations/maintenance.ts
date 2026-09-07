import type pg from "pg";

export interface MaintenanceResult {
  readonly webhookReceipts: number;
  readonly idempotencyRecords: number;
  readonly revokedSessions: number;
  readonly jobs: number;
}

export class MaintenanceService {
  constructor(private readonly pool: pg.Pool) {}

  async run(): Promise<MaintenanceResult> {
    const result = await this.pool.query<{
      webhook_receipts: string;
      operational_records: { idempotencyRecords: number; revokedSessions: number; jobs: number };
    }>(`SELECT
      prune_metricops_webhook_receipts(interval '24 hours') AS webhook_receipts,
      prune_metricops_operational_records(interval '30 days') AS operational_records`);
    const row = result.rows[0];
    if (!row) throw new Error("Maintenance did not return a result");
    return {
      webhookReceipts: Number(row.webhook_receipts),
      idempotencyRecords: Number(row.operational_records.idempotencyRecords),
      revokedSessions: Number(row.operational_records.revokedSessions),
      jobs: Number(row.operational_records.jobs),
    };
  }
}
