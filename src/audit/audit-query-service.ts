import type pg from "pg";
import { withTenantTransaction } from "../database/transaction.js";
import type { Principal } from "../domain/principal.js";

export interface AuditEventView {
  readonly sequence: string;
  readonly id: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly requestId: string;
  readonly occurredAt: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly previousHash: string | null;
  readonly chainHash: string;
}

export class AuditQueryService {
  constructor(private readonly pool: pg.Pool) {}

  async list(principal: Principal, limit: number): Promise<readonly AuditEventView[]> {
    return withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT sequence,id,actor_id,action,resource_type,resource_id,request_id,occurred_at,details,previous_hash,chain_hash
         FROM audit_events WHERE customer_id=$1 ORDER BY sequence DESC LIMIT $2`,
        [principal.customerId, limit],
      );
      return result.rows.map((row) => ({
        sequence: String(row.sequence), id: String(row.id), actorId: String(row.actor_id), action: String(row.action),
        resourceType: String(row.resource_type), resourceId: String(row.resource_id), requestId: String(row.request_id),
        occurredAt: (row.occurred_at as Date).toISOString(), details: row.details as Record<string, unknown>,
        previousHash: row.previous_hash === null ? null : String(row.previous_hash), chainHash: String(row.chain_hash),
      }));
    });
  }
}
