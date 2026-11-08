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
from canccu_kit import check_app_role, check_login_role, run_migrations, tenant_transaction

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
                await run_migrations(
                    migrator,
                    migrations,
                    ledger="tenants_migrations",
                    lock=_MIGRATION_LOCK,
                    app_role=APP_ROLE,
                    grant_to=login,
                )
            finally:
                await migrator.close()
        async with db.platform() as conn:
            await check_app_role(conn)
        return db

    async def migrate(self, migrations: Path) -> None:
        async with self.pool.acquire() as conn:
            await run_migrations(
                conn, migrations, ledger="tenants_migrations", lock=_MIGRATION_LOCK
            )

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
