import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { AuditService } from "../audit/audit-service.js";
import { conflict, notFound } from "../domain/errors.js";
import type { Principal } from "../domain/principal.js";
import { withTenantTransaction } from "../database/transaction.js";

export interface JobRecord {
  readonly id: string;
  readonly customerId: string;
  readonly kind: "connection.validate" | "aws.discover";
  readonly status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  readonly payload: { readonly connectionId: string };
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly errorCode: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

export interface JobView {
  readonly id: string;
  readonly kind: JobRecord["kind"];
  readonly status: JobRecord["status"];
  readonly result: JobRecord["result"];
  readonly errorCode: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id), customerId: String(row.customer_id), kind: row.kind as JobRecord["kind"],
    status: row.status as JobRecord["status"], payload: row.payload as JobRecord["payload"],
    result: row.result as JobRecord["result"], errorCode: row.error_code === null ? null : String(row.error_code),
    attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts), createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date, completedAt: row.completed_at instanceof Date ? row.completed_at : null,
  };
}

function toView(job: JobRecord): JobView {
  return {
    id: job.id, kind: job.kind, status: job.status, result: job.result, errorCode: job.errorCode,
    attempts: job.attempts, maxAttempts: job.maxAttempts, createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(), completedAt: job.completedAt?.toISOString() ?? null,
  };
}

const columns = "id, customer_id, kind, status, payload, result, error_code, attempts, max_attempts, created_at, updated_at, completed_at";

export class JobService {
  constructor(private readonly pool: pg.Pool, private readonly audit: AuditService) {}

  async enqueueConnectionValidation(principal: Principal, connectionId: string, idempotencyKey: string, requestId: string): Promise<JobView> {
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const connection = await client.query("SELECT 1 FROM connections WHERE customer_id = $1 AND id = $2 AND kind IN ('postgresql','mysql','prometheus','aws_assume_role') AND status <> 'disabled'", [principal.customerId, connectionId]);
      if (!connection.rowCount) throw notFound("Connection");
      const existing = await client.query(`SELECT ${columns} FROM jobs WHERE customer_id = $1 AND kind = 'connection.validate' AND idempotency_key = $2`, [principal.customerId, idempotencyKey]);
      if (existing.rows[0]) {
        const job = mapJob(existing.rows[0]);
        if (job.payload.connectionId !== connectionId) throw conflict("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for a different request");
        return toView(job);
      }
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO jobs (id, customer_id, kind, payload, idempotency_key, created_by)
         VALUES ($1,$2,'connection.validate',$3,$4,$5) RETURNING ${columns}`,
        [id, principal.customerId, { connectionId }, idempotencyKey, principal.subject],
      );
      await this.audit.append(client, {
        customerId: principal.customerId, actorId: principal.subject, action: "job.queued",
        resourceType: "job", resourceId: id, requestId, details: { kind: "connection.validate", connectionId },
      });
      return toView(mapJob(inserted.rows[0]));
    });
  }

  async enqueueAwsDiscovery(principal: Principal, connectionId: string, idempotencyKey: string, requestId: string): Promise<JobView> {
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const connection = await client.query("SELECT 1 FROM connections WHERE customer_id=$1 AND id=$2 AND kind='aws_assume_role' AND status<>'disabled'", [principal.customerId, connectionId]);
      if (!connection.rowCount) throw notFound("Connection");
      const existing = await client.query(`SELECT ${columns} FROM jobs WHERE customer_id=$1 AND kind='aws.discover' AND idempotency_key=$2`, [principal.customerId, idempotencyKey]);
      if (existing.rows[0]) {
        const job = mapJob(existing.rows[0]);
        if (job.payload.connectionId !== connectionId) throw conflict("IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for a different request");
        return toView(job);
      }
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO jobs(id,customer_id,kind,payload,idempotency_key,created_by)
         VALUES($1,$2,'aws.discover',$3,$4,$5) RETURNING ${columns}`,
        [id, principal.customerId, { connectionId }, idempotencyKey, principal.subject],
      );
      await this.audit.append(client, { customerId: principal.customerId, actorId: principal.subject, action: "job.queued", resourceType: "job", resourceId: id, requestId, details: { kind: "aws.discover", connectionId } });
      return toView(mapJob(inserted.rows[0]));
    });
  }

  async get(principal: Principal, jobId: string): Promise<JobView> {
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const result = await client.query(`SELECT ${columns} FROM jobs WHERE customer_id = $1 AND id = $2`, [principal.customerId, jobId]);
      if (!result.rows[0]) throw notFound("Job");
      return toView(mapJob(result.rows[0]));
    });
  }

  async claim(workerId: string, limit = 5, leaseSeconds = 60): Promise<readonly JobRecord[]> {
    const result = await this.pool.query("SELECT * FROM claim_metricops_jobs($1,$2,$3)", [workerId, limit, leaseSeconds]);
    return result.rows.map(mapJob);
  }

  async finish(workerId: string, job: JobRecord, succeeded: boolean, result: Readonly<Record<string, unknown>> | null, errorCode: string | null): Promise<void> {
    await withTenantTransaction(this.pool, { customerId: job.customerId, actorId: `worker:${workerId}` }, async (client) => {
      const finished = await client.query<{ finish_metricops_job: boolean }>("SELECT finish_metricops_job($1,$2,$3,$4,$5)", [workerId, job.id, succeeded, result, errorCode]);
      if (!finished.rows[0]?.finish_metricops_job) throw new Error("Job lease was lost before completion");
      const state = await client.query<{ status: JobRecord["status"]; attempts: number }>("SELECT status, attempts FROM jobs WHERE customer_id = $1 AND id = $2", [job.customerId, job.id]);
      const current = state.rows[0];
      if (!current) throw new Error("Completed job disappeared");
      await this.audit.append(client, {
        customerId: job.customerId, actorId: `worker:${workerId}`,
        action: current.status === "queued" ? "job.retry_scheduled" : `job.${current.status}`,
        resourceType: "job", resourceId: job.id, requestId: job.id,
        details: { kind: job.kind, attempts: current.attempts, errorCode },
      });
    });
  }
}
