/** Postgres access: every request's work runs in one tenant transaction as the theming app role. */
import type pg from "pg";
import { requireTenant, tenantTransaction, trackTransactions } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";

export const APP_ROLE = "canccu_theming_app";

export interface Db {
  /** Run `fn` in one transaction for the current tenant; RLS binds the app role it runs as. */
  tenant<T>(fn: (client: SqlClient) => Promise<T>): Promise<T>;
}

export function poolDb(pool: pg.Pool): Db {
  return {
    async tenant<T>(fn: (client: SqlClient) => Promise<T>): Promise<T> {
      // pg's overloaded query() is wider than the kit's SqlClient, which needs only (text, values).
      const client = trackTransactions(
        (await pool.connect()) as unknown as SqlClient & { release(): void },
      );
      try {
        return await tenantTransaction(
          client,
          async (c) => {
            // The login role owns nothing and RLS binds only the app role: switch first.
            await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
            return fn(c);
          },
          { tenant: requireTenant() },
        );
      } finally {
        client.release();
      }
    },
  };
}

export const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;
