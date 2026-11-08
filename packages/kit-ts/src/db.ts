/**
 * Postgres row-level security for tenant tables (0013 items 5–6). Driver-agnostic: anything with
 * pg's `query(text, values)` works, e.g. a `pg` PoolClient. `scripts/check-tenancy` lints the
 * migrations that use this SQL.
 */
import { requireTenant, withTenant } from "./tenant.js";

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const TENANT_SETTING = "canccu.tenant";

/**
 * The tenant of the current transaction, or NULL. `current_setting(…, true)` gives NULL before the
 * setting was ever used in the session but '' after a SET LOCAL has ended, so '' must mean "none"
 * too; otherwise a pooled connection's next query would compare against ''.
 */
export const CURRENT_TENANT_SQL = `NULLIF(current_setting('${TENANT_SETTING}', true), '')`;

/** The column every tenant table has: an insert without a tenant set fails on NOT NULL. */
export const TENANT_COLUMN_SQL = `tenant_id text NOT NULL DEFAULT ${CURRENT_TENANT_SQL}`;

export const TENANT_POLICY = "canccu_tenant";

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/**
 * RLS for one tenant table. FORCE makes the policy hold for the table's owner too; with no tenant
 * set the policy compares with NULL, so a query sees nothing and an insert fails.
 */
export function rlsSql(table: string): string {
  if (!IDENTIFIER_RE.test(table)) throw new RangeError(`invalid table ${JSON.stringify(table)}`);
  const match = `tenant_id = ${CURRENT_TENANT_SQL}`;
  return [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY ${TENANT_POLICY} ON ${table} USING (${match}) WITH CHECK (${match});`,
  ].join("\n");
}

/** Connections inside a tenant transaction now. */
const openTransactions = new WeakSet<SqlClient>();

/**
 * Run `fn` in one transaction for one tenant, on one checked-out connection (a `pg` PoolClient or
 * Client, never a Pool). The setting is transaction-local (set_config's third argument is SET
 * LOCAL), never per connection, so a pooled connection cannot carry a tenant into the next request.
 */
export async function tenantTransaction<C extends SqlClient, T>(
  client: C,
  fn: (client: C) => Promise<T>,
  options: { tenant?: string } = {},
): Promise<T> {
  const tenant = options.tenant ?? requireTenant();
  // A pool may run BEGIN, set_config and the work on different connections.
  if ("totalCount" in client) throw new TypeError("tenantTransaction needs a client, not a pool");
  // A nested BEGIN would commit the outer transaction early, and the inner tenant setting would
  // outlive the inner call: refuse instead.
  if (openTransactions.has(client)) {
    throw new Error("a tenant transaction is already open on this connection");
  }
  // The same trap with the caller's own BEGIN, which only a tracked client can see.
  if ((client as { inTransaction?: unknown }).inTransaction === true) {
    throw new Error("the connection is already in a transaction");
  }
  openTransactions.add(client);
  try {
    return await withTenant(tenant, async () => {
      await client.query("BEGIN");
      try {
        await client.query(`SELECT set_config('${TENANT_SETTING}', $1, true)`, [tenant]);
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        // The work's error is the one to report; a failed ROLLBACK (e.g. a lost connection)
        // leaves nothing committed either.
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
    });
  } finally {
    openTransactions.delete(client);
  }
}

/** A client that knows whether its connection is inside a transaction (see trackTransactions). */
export interface TrackedClient extends SqlClient {
  readonly inTransaction: boolean;
  release(err?: unknown): void;
}

// Comments may precede the keyword; Postgres nests block comments, which this does not follow.
const LEADING_COMMENTS_RE = /^(\s+|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)*/;
const START_RE = /^(begin|start\s+transaction)\b/i;
const END_RE = /^(commit|end|rollback|abort|prepare\s+transaction)\b/i;
const SAVEPOINT_ROLLBACK_RE = /^rollback\s+((work|transaction)\s+)?to\b/i;
// COMMIT/ROLLBACK AND CHAIN end one transaction and open the next at once.
const CHAIN_RE = /\band\s+chain\b/i;

class TransactionTracker implements TrackedClient {
  inTransaction = false;

  constructor(private readonly inner: SqlClient & { release?: (err?: unknown) => void }) {}

  async query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    const statement = text.replace(LEADING_COMMENTS_RE, "");
    const ends = END_RE.test(statement) && !SAVEPOINT_ROLLBACK_RE.test(statement);
    try {
      const result = await this.inner.query(text, values);
      if (START_RE.test(statement)) this.inTransaction = true;
      return result;
    } finally {
      // A failed COMMIT still ends the transaction (Postgres rolls it back); any other failure
      // inside one leaves it open, aborted, until ROLLBACK.
      if (ends) this.inTransaction = CHAIN_RE.test(statement);
    }
  }

  release(err?: unknown): void {
    this.inner.release?.(err);
  }
}

/**
 * Wrap a checked-out connection so tenantTransaction can refuse to start inside the caller's own
 * transaction, whose COMMIT would otherwise come early. Only the leading keyword of each query
 * is read, so a multi-statement string that opens or ends a transaction later is not seen.
 */
export function trackTransactions(
  client: SqlClient & { release?: (err?: unknown) => void },
): TrackedClient {
  return new TransactionTracker(client);
}

export class RlsBypassed extends Error {
  override name = "RlsBypassed";
}

/**
 * Refuse to run as a role that RLS does not bind: a superuser or BYPASSRLS role sees every
 * tenant's rows whatever the policies say. Call at start, before serving.
 */
export async function checkAppRole(client: SqlClient): Promise<void> {
  const { rows } = await client.query(
    "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
  );
  const role = rows[0];
  if (role === undefined || role.rolsuper === true || role.rolbypassrls === true) {
    throw new RlsBypassed(
      `database role ${String(role?.rolname)} bypasses row-level security; use the app role`,
    );
  }
}

/**
 * Refuse a login role that could undo RLS: a superuser or BYPASSRLS role ignores it, and a role
 * owning tables can switch it off or drop the policies. Call at start on a fresh connection, before
 * any SET ROLE to the app role; `session_user` is the login role whatever SET ROLE did since.
 */
export async function checkLoginRole(client: SqlClient): Promise<void> {
  const { rows } = await client.query(
    `SELECT r.rolname, r.rolsuper, r.rolbypassrls,
       EXISTS (
         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relowner = r.oid
           AND n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND n.nspname NOT LIKE 'pg\\_toast%'
       ) AS owns_relations
     FROM pg_roles r WHERE r.rolname = session_user`,
  );
  const role = rows[0];
  const name = String(role?.rolname);
  if (role === undefined) throw new RlsBypassed("the database login role was not found");
  if (role.rolsuper === true) throw new RlsBypassed(`login role ${name} is a superuser`);
  if (role.rolbypassrls === true) throw new RlsBypassed(`login role ${name} has BYPASSRLS`);
  if (role.owns_relations === true) {
    throw new RlsBypassed(`login role ${name} owns tables; log in as a role that owns none`);
  }
}
