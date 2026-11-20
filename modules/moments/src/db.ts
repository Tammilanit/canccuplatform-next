/** Postgres access: every piece of work runs in one transaction as the moments app role. */
import type pg from "pg";
import { requireTenant, tenantTransaction, trackTransactions } from "@canccu/kit";
import type { OutboxDb, SqlClient } from "@canccu/kit";

export const APP_ROLE = "canccu_moments_app";
export const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;

export type Db = OutboxDb;

interface Committed {
  run: () => Promise<void>;
  dropped: (() => void) | undefined;
}

/**
 * Work outside Postgres that may happen only once its transaction commits, by transaction (each
 * run's client is a new wrapper): a rollback, or a savepoint's, never did it (#657).
 */
const committed = new WeakMap<SqlClient, Committed[]>();

/**
 * Runs `run` after `c`'s transaction commits, before the transaction's caller goes on; `run`
 * handles its own faults, since the commit has happened. `dropped` runs when a savepoint
 * (`isolated`) rolls it back.
 */
export function afterCommit(c: SqlClient, run: () => Promise<void>, dropped?: () => void): void {
  const list = committed.get(c) ?? [];
  list.push({ run, dropped });
  committed.set(c, list);
}

async function runCommitted(c: SqlClient): Promise<void> {
  for (const x of committed.get(c) ?? []) await x.run();
}

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
        const out = await tenantTransaction(
          client,
          async (c) => {
            // The login role owns nothing and RLS binds only the app role: switch first.
            await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
            return fn(c);
          },
          { tenant },
        );
        await runCommitted(client);
        return out;
      }
      await client.query("BEGIN");
      let out: T;
      try {
        await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
        out = await fn(client);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
      await runCommitted(client);
      return out;
    } finally {
      client.release();
    }
  };
  return {
    tenant: (fn) => run(fn, requireTenant()),
    global: (fn) => run(fn, null),
  };
}

/**
 * `fn` in a savepoint of the open transaction: its fault rolls back its own writes only, and the
 * rest of that transaction (an event's whole tick) goes on. The fault goes to `failed`.
 */
export async function isolated(
  c: SqlClient,
  fn: () => Promise<void>,
  failed: (err: unknown) => void,
): Promise<void> {
  await c.query(`SAVEPOINT isolated`, []);
  const before = committed.get(c)?.length ?? 0;
  try {
    await fn();
  } catch (err) {
    await c.query(`ROLLBACK TO SAVEPOINT isolated`, []);
    for (const x of committed.get(c)?.splice(before) ?? []) x.dropped?.();
    failed(err);
  }
  await c.query(`RELEASE SAVEPOINT isolated`, []);
}
