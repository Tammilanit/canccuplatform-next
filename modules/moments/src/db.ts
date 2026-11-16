/** Postgres access: every piece of work runs in one transaction as the moments app role. */
import type pg from "pg";
import { requireTenant, tenantTransaction, trackTransactions } from "@canccu/kit";
import type { OutboxDb, SqlClient } from "@canccu/kit";

export const APP_ROLE = "canccu_moments_app";
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
