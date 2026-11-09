/** Postgres access: every request's work runs in one tenant transaction as the screen app role. */
import type pg from "pg";
import { requireTenant, tenantTransaction, trackTransactions } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";

export const APP_ROLE = "canccu_screen_app";

/** Rows of `devices`, the global table (contracts/screen.md, Tenancy). */
export interface DeviceRow {
  id: string;
  name: string;
  token_hash: string | null;
  superseded_token_hashes: { hash: string; expires_at: string }[];
  venue_id: string | null;
  current_tenant_id: string | null;
  created_at: Date;
  revoked_at: Date | null;
}

export interface Db {
  /** Run `fn` in one transaction for the current tenant; RLS binds the app role it runs as. */
  tenant<T>(fn: (client: SqlClient) => Promise<T>): Promise<T>;
  /**
   * Run `fn` in one transaction for no tenant, as the app role: it reads only the global
   * `devices` table, since RLS shows no tenant's rows without a tenant.
   */
  global<T>(fn: (client: SqlClient) => Promise<T>): Promise<T>;
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
    async global<T>(fn: (client: SqlClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
          const result = await fn(client);
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw err;
        }
      } finally {
        client.release();
      }
    },
  };
}

export const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;
