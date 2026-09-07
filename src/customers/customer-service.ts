import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { AuditService } from "../audit/audit-service.js";
import type { Principal } from "../domain/principal.js";

export class CustomerService {
  constructor(private readonly pool: pg.Pool, private readonly audit: AuditService) {}

  async create(principal: Principal, name: string, requestId: string) {
    const client = await this.pool.connect();
    const customerId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO customers (id, name) VALUES ($1, $2)", [customerId, name]);
      await client.query("SELECT set_config('app.current_customer_id', $1, true)", [customerId]);
      await this.audit.append(client, {
        customerId,
        actorId: principal.subject,
        action: "customer.created",
        resourceType: "customer",
        resourceId: customerId,
        requestId,
        details: { name },
      });
      await client.query("COMMIT");
      return { id: customerId, name, status: "active" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
