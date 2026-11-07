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

/**
 * Run `fn` in one transaction for one tenant. The setting is transaction-local (set_config's third
 * argument is SET LOCAL), never per connection, so a pooled connection cannot carry a tenant into
 * the next request.
 */
export async function tenantTransaction<C extends SqlClient, T>(
  client: C,
  fn: (client: C) => Promise<T>,
  options: { tenant?: string } = {},
): Promise<T> {
  const tenant = options.tenant ?? requireTenant();
  return withTenant(tenant, async () => {
    await client.query("BEGIN");
    try {
      await client.query(`SELECT set_config('${TENANT_SETTING}', $1, true)`, [tenant]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });
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
