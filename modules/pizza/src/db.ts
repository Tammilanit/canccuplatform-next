/** Postgres access: every piece of work runs in one transaction as the pizza app role. */
import type pg from "pg";
import { requireTenant, tenantTransaction, trackTransactions } from "@canccu/kit";
import type { OutboxDb, SqlClient } from "@canccu/kit";

export const APP_ROLE = "canccu_pizza_app";
export const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;

export type Db = OutboxDb;

export function poolDb(pool: pg.Pool): Db {
  const run = async <T>(
    fn: (client: SqlClient) => Promise<T>,
    tenant: string | null,
  ): Promise<T> => {
    // pg's overloaded query() is wider than the kit's SqlClient, which needs only (text, values).
    const client = trackTransactions(
      (await pool.connect()) as unknown as SqlClient & { release(): void },
    );
    try {
      if (tenant !== null) {
        return await tenantTransaction(
          client,
          async (c) => {
            // The login role owns nothing and RLS binds only the app role: switch first.
            await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
            return fn(c);
          },
          { tenant },
        );
      }
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    } finally {
      client.release();
    }
  };
  return {
    tenant: (fn) => run(fn, requireTenant()),
    global: (fn) => run(fn, null),
  };
}

/** Within a global transaction: the tenant RLS sees from here on (a clone reads one, writes another). */
export async function asTenant(c: SqlClient, tenant: string): Promise<void> {
  await c.query(`SELECT set_config('canccu.tenant', $1, true)`, [tenant]);
}

/** The events pizza has served, so platform events (a deleted user) reach each of them. */
export async function noteTenant(db: Db, tenant: string): Promise<void> {
  await db.global((c) =>
    c.query(`INSERT INTO pizza_tenants (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [tenant]),
  );
}
