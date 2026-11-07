"""Persistence: each tenant's settings and profile record, in Postgres (a memory twin for tests).

Every method works for the current tenant (the kit's tenant_scope, set from the request's
hostname) and raises NoTenant without one: no caller can name another tenant here. The login role
owns the tables and may be a superuser, which RLS never binds, so each transaction switches to
`canccu_admin_app` with SET LOCAL ROLE (as the tenants module does).
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Protocol

import asyncpg
from canccu_kit import VersionConflict, check_app_role, require_tenant, tenant_transaction

APP_ROLE = "canccu_admin_app"
# The image sets CANCCU_MIGRATIONS_DIR: an installed package has no migrations next to it.
MIGRATIONS = Path(
    os.environ.get("CANCCU_MIGRATIONS_DIR", Path(__file__).resolve().parents[2] / "migrations")
)
_MIGRATION_LOCK = 0x7E7A_AD31  # any constant; serialises starts of several containers


def _conflict() -> VersionConflict:
    return VersionConflict("settings changed since they were read; read again and retry")


class Store(Protocol):
    async def get_settings(self, module: str) -> tuple[int, dict[str, Any]]: ...

    async def put_settings(
        self, module: str, expected_version: int, values: dict[str, Any]
    ) -> int: ...

    async def get_profile(self) -> dict[str, Any] | None: ...

    async def set_profile(self, document: dict[str, Any]) -> None: ...

    async def ping(self) -> None: ...

    async def close(self) -> None: ...


class MemoryStore:
    def __init__(self) -> None:
        self.settings: dict[tuple[str, str], tuple[int, dict[str, Any]]] = {}
        self.profiles: dict[str, dict[str, Any]] = {}
        self.healthy = True

    async def get_settings(self, module: str) -> tuple[int, dict[str, Any]]:
        version, values = self.settings.get((require_tenant(), module), (0, {}))
        return version, dict(values)

    async def put_settings(self, module: str, expected_version: int, values: dict[str, Any]) -> int:
        key = (require_tenant(), module)
        version, _ = self.settings.get(key, (0, {}))
        if version != expected_version:
            raise _conflict()
        self.settings[key] = (version + 1, dict(values))
        return version + 1

    async def get_profile(self) -> dict[str, Any] | None:
        return self.profiles.get(require_tenant())

    async def set_profile(self, document: dict[str, Any]) -> None:
        self.profiles[require_tenant()] = document

    async def ping(self) -> None:
        if not self.healthy:
            raise ConnectionError("postgres unreachable")

    async def close(self) -> None:
        return None


class PgStore:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    @property
    def pool(self) -> asyncpg.Pool:
        return self._pool

    @classmethod
    async def connect(cls, url: str, migrations: Path = MIGRATIONS) -> PgStore:
        pool = await asyncpg.create_pool(url, min_size=1, max_size=5)
        store = cls(pool)
        await store.migrate(migrations)
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute(f"SET LOCAL ROLE {APP_ROLE}")
            await check_app_role(conn)
        return store

    async def migrate(self, migrations: Path) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute("SELECT pg_advisory_lock($1)", _MIGRATION_LOCK)
            try:
                # Each file runs once, in its own transaction: CREATE POLICY cannot be repeated.
                await conn.execute(
                    "CREATE TABLE IF NOT EXISTS admin_migrations"
                    " (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
                )
                # Start-up only, before serving: a blocking read is fine here.
                for path in sorted(migrations.glob("*.sql")):  # noqa: ASYNC240
                    async with conn.transaction():
                        done = await conn.fetchval(
                            "SELECT 1 FROM admin_migrations WHERE name = $1", path.name
                        )
                        if not done:
                            await conn.execute(path.read_text())
                            await conn.execute(
                                "INSERT INTO admin_migrations (name) VALUES ($1)", path.name
                            )
            finally:
                await conn.execute("SELECT pg_advisory_unlock($1)", _MIGRATION_LOCK)

    @asynccontextmanager
    async def _tenant(self) -> AsyncIterator[Any]:
        """One transaction that sees only the current tenant's rows."""
        async with self._pool.acquire() as conn, tenant_transaction(conn):
            await conn.execute(f"SET LOCAL ROLE {APP_ROLE}")
            yield conn

    async def get_settings(self, module: str) -> tuple[int, dict[str, Any]]:
        async with self._tenant() as conn:
            row = await conn.fetchrow(
                "SELECT settings_version, values FROM admin_tenant_settings WHERE module = $1",
                module,
            )
        if row is None:
            return 0, {}
        return int(row["settings_version"]), json.loads(row["values"])

    async def put_settings(self, module: str, expected_version: int, values: dict[str, Any]) -> int:
        payload = json.dumps(values)
        async with self._tenant() as conn:
            if expected_version == 0:
                # tenant_id comes from its default, the transaction's tenant setting.
                row = await conn.fetchrow(
                    "INSERT INTO admin_tenant_settings (module, settings_version, values)"
                    " VALUES ($1, 1, $2::jsonb) ON CONFLICT DO NOTHING RETURNING settings_version",
                    module,
                    payload,
                )
            else:
                row = await conn.fetchrow(
                    "UPDATE admin_tenant_settings SET settings_version = settings_version + 1,"
                    " values = $3::jsonb WHERE module = $1 AND settings_version = $2"
                    " RETURNING settings_version",
                    module,
                    expected_version,
                    payload,
                )
        if row is None:
            raise _conflict()
        return int(row["settings_version"])

    async def get_profile(self) -> dict[str, Any] | None:
        async with self._tenant() as conn:
            raw = await conn.fetchval("SELECT document FROM admin_tenant_profile")
        return json.loads(raw) if raw is not None else None

    async def set_profile(self, document: dict[str, Any]) -> None:
        async with self._tenant() as conn:
            await conn.execute(
                "INSERT INTO admin_tenant_profile (document) VALUES ($1::jsonb)"
                " ON CONFLICT (tenant_id) DO UPDATE SET document = EXCLUDED.document",
                json.dumps(document),
            )

    async def ping(self) -> None:
        await self._pool.fetchval("SELECT 1")

    async def close(self) -> None:
        await self._pool.close()
