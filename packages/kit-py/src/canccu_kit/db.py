"""Postgres row-level security for tenant tables (0013 items 5 and 6).

Driver-agnostic: anything shaped like an asyncpg Connection works. `scripts/check-tenancy` lints
the migrations that use this SQL.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Mapping
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Any, Protocol
from weakref import WeakSet

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


_open_transactions: WeakSet[Any] = WeakSet()
"""Connections inside a tenant transaction now."""


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
    if conn in _open_transactions:
        raise RuntimeError("a tenant transaction is already open on this connection")
    _open_transactions.add(conn)
    try:
        with tenant_scope(tenant):
            async with conn.transaction():
                await conn.execute(f"SELECT set_config('{TENANT_SETTING}', $1, true)", tenant)
                yield conn
    finally:
        _open_transactions.discard(conn)


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
