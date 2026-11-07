"""Postgres: migrations and the two kinds of transaction every request uses.

The login role owns the tables and may be a superuser, which RLS never binds. So each transaction
switches to `canccu_tenants_app` with SET LOCAL ROLE: the per-tenant tables then show only the
tenant set by the kit's `tenant_transaction`, and nothing at all in a platform transaction.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import asyncpg
from canccu_kit import check_app_role, tenant_transaction

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
    async def connect(cls, url: str, migrations: Path = MIGRATIONS) -> Db:
        pool = await asyncpg.create_pool(url, min_size=1, max_size=10)
        db = cls(pool)
        await db.migrate(migrations)
        async with db.platform() as conn:
            await check_app_role(conn)
        return db

    async def migrate(self, migrations: Path) -> None:
        async with self.pool.acquire() as conn:
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
