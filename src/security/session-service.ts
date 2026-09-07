import { createHash } from "node:crypto";
import type pg from "pg";
import type { AuditService } from "../audit/audit-service.js";
import { unauthorized } from "../domain/errors.js";
import type { Principal } from "../domain/principal.js";
import { withTenantTransaction } from "../database/transaction.js";

function tokenHash(tokenId: string): string {
  return createHash("sha256").update(tokenId, "utf8").digest("hex");
}

export class SessionService {
  constructor(private readonly pool: pg.Pool, private readonly audit: AuditService) {}

  async assertActive(principal: Principal): Promise<void> {
    const result = await this.pool.query(
      `SELECT 1 FROM revoked_sessions
       WHERE token_hash = $1 AND customer_id = $2 AND expires_at > now()`,
      [tokenHash(principal.tokenId), principal.customerId],
    );
    if (result.rowCount) throw unauthorized();
  }

  async revokeCurrent(principal: Principal, requestId: string): Promise<void> {
    await withTenantTransaction(this.pool, { customerId: principal.customerId, actorId: principal.subject }, async (client) => {
      await client.query(
        `INSERT INTO revoked_sessions (token_hash, customer_id, subject_id, expires_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (token_hash) DO NOTHING`,
        [tokenHash(principal.tokenId), principal.customerId, principal.subject, principal.expiresAt],
      );
      await this.audit.append(client, {
        customerId: principal.customerId,
        actorId: principal.subject,
        action: "session.revoked",
        resourceType: "session",
        resourceId: tokenHash(principal.tokenId).slice(0, 16),
        requestId,
      });
    });
  }
}
