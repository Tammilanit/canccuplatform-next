"""Postgres row-level security for tenant tables (0013 items 5 and 6).

Driver-agnostic: anything shaped like an asyncpg Connection works. `scripts/check-tenancy` lints
the migrations that use this SQL.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Mapping
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from pathlib import Path
from typing import Any, Protocol

from .tenant import require_tenant, tenant_scope


class SqlConnection(Protocol):
    async def execute(self, query: str, *args: Any) -> Any: ...

    async def fetchrow(self, query: str, *args: Any) -> Mapping[str, Any] | None: ...

    def transaction(self) -> AbstractAsyncContextManager[Any]: ...


TENANT_SETTING = "canccu.tenant"

CURRENT_TENANT_SQL = f"NULLIF(current_setting('{TENANT_SETTING}', true), '')"
"""The tenant of the current transaction, or NULL.

`current_setting(…, true)` gives NULL before the setting was ever used in the session but '' after
a SET LOCAL has ended, so '' must mean "none" too; otherwise a pooled connection's next query
would compare against ''.
"""

TENANT_COLUMN_SQL = f"tenant_id text NOT NULL DEFAULT {CURRENT_TENANT_SQL}"
"""The column every tenant table has: an insert without a tenant set fails on NOT NULL."""

TENANT_POLICY = "canccu_tenant"

_IDENTIFIER_RE = re.compile(r"[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?")


def rls_sql(table: str) -> str:
    """RLS for one tenant table.

    FORCE makes the policy hold for the table's owner too; with no tenant set the policy compares
    with NULL, so a query sees nothing and an insert fails.
    """
    if _IDENTIFIER_RE.fullmatch(table) is None:
        raise ValueError(f"invalid table {table!r}")
    match = f"tenant_id = {CURRENT_TENANT_SQL}"
    return "\n".join(
        [
            f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;",
            f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;",
            f"CREATE POLICY {TENANT_POLICY} ON {table} USING ({match}) WITH CHECK ({match});",
        ]
    )


_open_transactions: set[int] = set()
"""`id()` of each connection inside a tenant transaction now. Not a WeakSet: asyncpg's pooled
PoolConnectionProxy cannot be weak-referenced. An id stays here only while the caller holds the
connection, so it cannot be reused by another object meanwhile."""


@asynccontextmanager
async def tenant_transaction[C: SqlConnection](
    conn: C, tenant: str | None = None
) -> AsyncIterator[C]:
    """Run a block in one transaction for one tenant (by default the current one).

    The setting is transaction-local (set_config's third argument is SET LOCAL), never per
    connection, so a pooled connection cannot carry a tenant into the next request.
    """
    tenant = require_tenant() if tenant is None else tenant
    # A nested transaction is a savepoint, and set_config inside it outlives the savepoint until
    # the outer transaction ends: the outer block would run as the inner tenant. Refuse instead.
    # asyncpg says whether a transaction is open; with other drivers only a nested tenant
    # transaction is caught, below.
    in_transaction = getattr(conn, "is_in_transaction", None)
    if callable(in_transaction) and in_transaction():
        raise RuntimeError("the connection is already in a transaction")
    key = id(conn)
    if key in _open_transactions:
        raise RuntimeError("a tenant transaction is already open on this connection")
    _open_transactions.add(key)
    try:
        with tenant_scope(tenant):
            async with conn.transaction():
                await conn.execute(f"SELECT set_config('{TENANT_SETTING}', $1, true)", tenant)
                yield conn
    finally:
        _open_transactions.discard(key)


class RlsBypassed(RuntimeError):
    """The database role is not bound by row-level security."""


async def check_app_role(conn: SqlConnection) -> None:
    """Refuse to run as a role that RLS does not bind.

    A superuser or BYPASSRLS role sees every tenant's rows whatever the policies say. Call at
    start, before serving.
    """
    role = await conn.fetchrow(
        "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
    )
    if role is None or role["rolsuper"] is True or role["rolbypassrls"] is True:
        name = None if role is None else role["rolname"]
        raise RlsBypassed(f"database role {name} bypasses row-level security; use the app role")


async def check_login_role(conn: SqlConnection) -> None:
    """Refuse to log in as anything but a plain role (0013 item 5).

    Call on a fresh connection, before any SET ROLE. A table's owner may switch RLS off or drop
    its policy, so the role a module logs in as owns nothing; migrations run as another role.
    """
    role = await conn.fetchrow(
        "SELECT r.rolname, r.rolsuper, r.rolbypassrls, EXISTS ("
        " SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
        " WHERE c.relowner = r.oid AND n.nspname <> 'information_schema'"
        " AND n.nspname NOT LIKE 'pg\\_%') AS owns"
        " FROM pg_roles r WHERE r.rolname = current_user"
    )
    if role is None or role["rolsuper"] is not False or role["rolbypassrls"] is not False:
        name = None if role is None else role["rolname"]
        raise RlsBypassed(f"database login role {name} bypasses row-level security")
    if role["owns"] is not False:
        raise RlsBypassed(f"database login role {role['rolname']} owns tables; use the app role")


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


async def run_migrations(
    conn: Any,
    migrations: Path,
    *,
    ledger: str,
    lock: int,
    app_role: str | None = None,
    grant_to: str | None = None,
) -> None:
    """Run each new `*.sql` file in `migrations` once, in name order, recorded in `ledger`.

    Run it as the migration role, at start, before serving. Each file runs in its own transaction
    (CREATE POLICY cannot be repeated); the advisory `lock` serialises containers starting at
    once. With `grant_to`, the login role then gets the module's `app_role`: the migration role
    created that role, so it holds ADMIN OPTION on it.
    """
    if _IDENTIFIER_RE.fullmatch(ledger) is None:
        raise ValueError(f"invalid ledger table {ledger!r}")
    await conn.execute("SELECT pg_advisory_lock($1)", lock)
    try:
        await conn.execute(
            f"CREATE TABLE IF NOT EXISTS {ledger}"
            " (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        # Start-up only, before serving: a blocking read is fine here.
        for path in sorted(migrations.glob("*.sql")):  # noqa: ASYNC240
            async with conn.transaction():
                done = await conn.fetchval(f"SELECT 1 FROM {ledger} WHERE name = $1", path.name)
                if not done:
                    await conn.execute(path.read_text())
                    await conn.execute(f"INSERT INTO {ledger} (name) VALUES ($1)", path.name)
    finally:
        await conn.execute("SELECT pg_advisory_unlock($1)", lock)
    if grant_to is not None and app_role is not None:
        await conn.execute(f"GRANT {quote_ident(app_role)} TO {quote_ident(grant_to)}")
