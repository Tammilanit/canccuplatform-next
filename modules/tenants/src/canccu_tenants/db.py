"""Postgres: migrations and the two kinds of transaction every request uses.

Migrations run as the migration role, which owns the tables (0013 item 5); the module serves as a
plain login role that owns nothing and is granted `canccu_tenants_app`. Each transaction switches
to that role with SET LOCAL ROLE: the per-tenant tables then show only the tenant set by the kit's
`tenant_transaction`, and nothing at all in a platform transaction. Tests pass one superuser URL
for both, which RLS does not bind; the SET LOCAL ROLE is what they rely on.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import asyncpg
from canccu_kit import check_app_role, check_login_role, tenant_transaction

APP_ROLE = "canccu_tenants_app"
# The image sets CANCCU_MIGRATIONS_DIR: an installed package has no migrations next to it.
MIGRATIONS = Path(
    os.environ.get("CANCCU_MIGRATIONS_DIR", Path(__file__).resolve().parents[2] / "migrations")
)
_MIGRATION_LOCK = 0x7E7A_7350  # any constant; serialises starts of several containers


class Db:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    @classmethod
    async def connect(
        cls, url: str, migrations: Path = MIGRATIONS, *, migrate_url: str | None = None
    ) -> Db:
        """With `migrate_url`, migrations run as that role and the login role of `url` must be
        plain (the stack); without, `url` does both (tests, a superuser)."""
        pool = await asyncpg.create_pool(url, min_size=1, max_size=10)
        db = cls(pool)
        if migrate_url is None:
            await db.migrate(migrations)
        else:
            async with pool.acquire() as conn:
                await check_login_role(conn)
                login = await conn.fetchval("SELECT current_user")
            migrator = await asyncpg.connect(migrate_url)
            try:
                await migrate(migrator, migrations, grant_to=login)
            finally:
                await migrator.close()
        async with db.platform() as conn:
            await check_app_role(conn)
        return db

    async def migrate(self, migrations: Path) -> None:
        async with self.pool.acquire() as conn:
            await migrate(conn, migrations)

    @asynccontextmanager
    async def platform(self) -> AsyncIterator[Any]:
        """Global tables only: no tenant is set, so RLS tables show nothing."""
        async with self.pool.acquire() as conn, conn.transaction():
            await conn.execute(f"SET LOCAL ROLE {APP_ROLE}")
            yield conn

    @asynccontextmanager
    async def tenant(self, tenant_id: str | None = None) -> AsyncIterator[Any]:
        """Global tables plus one tenant's rows (by default the current tenant)."""
        async with self.pool.acquire() as conn, tenant_transaction(conn, tenant_id):
            await conn.execute(f"SET LOCAL ROLE {APP_ROLE}")
            yield conn

    async def close(self) -> None:
        await self.pool.close()


async def migrate(conn: Any, migrations: Path, *, grant_to: str | None = None) -> None:
    """Run each new migration file once; then let the login role `grant_to` take the app role."""
    await conn.execute("SELECT pg_advisory_lock($1)", _MIGRATION_LOCK)
    try:
        # Each file runs once, in its own transaction: CREATE POLICY cannot be repeated.
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS tenants_migrations"
            " (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        # Start-up only, before serving: a blocking read is fine here.
        for path in sorted(migrations.glob("*.sql")):  # noqa: ASYNC240
            async with conn.transaction():
                done = await conn.fetchval(
                    "SELECT 1 FROM tenants_migrations WHERE name = $1", path.name
                )
                if not done:
                    await conn.execute(path.read_text())
                    await conn.execute(
                        "INSERT INTO tenants_migrations (name) VALUES ($1)", path.name
                    )
    finally:
        await conn.execute("SELECT pg_advisory_unlock($1)", _MIGRATION_LOCK)
    if grant_to is not None:
        # The migration role created the app role, so it may grant it (ADMIN OPTION); the login
        # role then reaches the tables only through SET LOCAL ROLE and the app role's grants.
        await conn.execute(f"GRANT {APP_ROLE} TO {quote_ident(grant_to)}")


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'
