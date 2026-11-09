/**
 * Schema migrations, the same behaviour as kit-py's `run_migrations`, so TypeScript and Python
 * modules start the same way: plain `*.sql` files run once each, in name order.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SqlClient } from "./db.js";

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

/** A role name as a quoted identifier; roles come from the environment, never from a request. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export interface MigrationOptions {
  /** The table that records which files ran, e.g. `screen_migrations` (a global table). */
  ledger: string;
  /** The advisory lock key: one per module, so containers starting at once run each file once. */
  lock: number;
  /** With `grantTo`: the login role gets the module's app role, which the migrations created. */
  appRole?: string;
  grantTo?: string;
}

/**
 * Run each new `*.sql` file in `dir` once, recorded in the ledger. Run it as the migration role
 * on one checked-out connection, at start, before serving. Each file runs in its own transaction,
 * because CREATE POLICY cannot be repeated and a half-run file must leave nothing behind.
 */
export async function runMigrations(
  client: SqlClient,
  dir: string,
  options: MigrationOptions,
): Promise<string[]> {
  const { ledger, lock } = options;
  if (!IDENTIFIER_RE.test(ledger)) throw new RangeError(`invalid ledger table ${ledger}`);
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  const applied: string[] = [];
  await client.query("SELECT pg_advisory_lock($1)", [lock]);
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${ledger}` +
        " (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of names) {
      const sql = await readFile(join(dir, name), "utf8");
      await client.query("BEGIN");
      try {
        const { rows } = await client.query(`SELECT 1 FROM ${ledger} WHERE name = $1`, [name]);
        if (rows.length === 0) {
          await client.query(sql);
          await client.query(`INSERT INTO ${ledger} (name) VALUES ($1)`, [name]);
          applied.push(name);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lock]);
  }
  if (options.appRole !== undefined && options.grantTo !== undefined) {
    await client.query(`GRANT ${quoteIdent(options.appRole)} TO ${quoteIdent(options.grantTo)}`);
  }
  return applied;
}
