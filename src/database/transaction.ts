import type pg from "pg";

export interface TenantContext {
  readonly customerId: string;
  readonly actorId: string;
}

export async function withTenantTransaction<T>(
  pool: pg.Pool,
  context: TenantContext,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_customer_id', $1, true)", [context.customerId]);
    await client.query("SELECT set_config('app.current_actor_id', $1, true)", [context.actorId]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
