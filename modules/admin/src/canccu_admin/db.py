"""Persistence: each tenant's settings and profile record, in Postgres (a memory twin for tests).

Every method works for the current tenant (the kit's tenant_scope, set from the request's
hostname) and raises NoTenant without one: no caller can name another tenant here. Migrations run
as the migration role, which owns the tables (0013 item 5); admin serves as a plain login role
granted `canccu_admin_app`, and each transaction switches to it with SET LOCAL ROLE (as the
tenants module does), which also keeps tests on a superuser URL bound by RLS.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

import asyncpg
from canccu_kit import (
    VersionConflict,
    check_app_role,
    check_login_role,
    require_tenant,
    run_migrations,
    tenant_transaction,
)

APP_ROLE = "canccu_admin_app"
# The image sets CANCCU_MIGRATIONS_DIR: an installed package has no migrations next to it.
MIGRATIONS = Path(
    os.environ.get("CANCCU_MIGRATIONS_DIR", Path(__file__).resolve().parents[2] / "migrations")
)
_MIGRATION_LOCK = 0x7E7A_AD31  # any constant; serialises starts of several containers


def _conflict() -> VersionConflict:
    return VersionConflict("settings changed since they were read; read again and retry")


@dataclass(frozen=True)
class SettingsChange:
    """One saved change: each changed key's new value, who saved it and when."""

    module: str
    changes: dict[str, Any]
    actor_user_id: str
    changed_at: datetime


class Store(Protocol):
    async def get_settings(self, module: str) -> tuple[int, dict[str, Any]]: ...

    async def put_settings(
        self, module: str, expected_version: int, values: dict[str, Any]
    ) -> int: ...

    async def record_change(self, module: str, changes: dict[str, Any], actor: str) -> None: ...

    async def recent_changes(self, limit: int) -> list[SettingsChange]: ...

    async def last_changed(self) -> dict[str, datetime]: ...

    async def get_profile(self) -> dict[str, Any] | None: ...

    async def set_profile(self, document: dict[str, Any], loaded_by: str | None = None) -> None:
        """Store the profile record; `loaded_by` (a user id) marks it as loaded now."""

    async def profile_loaded(self) -> tuple[datetime, str] | None:
        """When the profile was last loaded and by whom, or None if never."""

    async def ping(self) -> None: ...

    async def close(self) -> None: ...


class MemoryStore:
    def __init__(self) -> None:
        self.settings: dict[tuple[str, str], tuple[int, dict[str, Any]]] = {}
        self.profiles: dict[str, dict[str, Any]] = {}
        self.loads: dict[str, tuple[datetime, str]] = {}
        self.changes: dict[str, list[SettingsChange]] = {}
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

    async def record_change(self, module: str, changes: dict[str, Any], actor: str) -> None:
        change = SettingsChange(module, dict(changes), actor, datetime.now(UTC))
        self.changes.setdefault(require_tenant(), []).append(change)

    async def recent_changes(self, limit: int) -> list[SettingsChange]:
        return list(reversed(self.changes.get(require_tenant(), [])))[:limit]

    async def last_changed(self) -> dict[str, datetime]:
        return {c.module: c.changed_at for c in self.changes.get(require_tenant(), [])}

    async def get_profile(self) -> dict[str, Any] | None:
        return self.profiles.get(require_tenant())

    async def set_profile(self, document: dict[str, Any], loaded_by: str | None = None) -> None:
        self.profiles[require_tenant()] = document
        if loaded_by is not None:
            self.loads[require_tenant()] = (datetime.now(UTC), loaded_by)

    async def profile_loaded(self) -> tuple[datetime, str] | None:
        return self.loads.get(require_tenant())

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
    async def connect(
        cls, url: str, migrations: Path = MIGRATIONS, *, migrate_url: str | None = None
    ) -> PgStore:
        """With `migrate_url`, migrations run as that role and the login role of `url` must be
        plain (the stack); without, `url` does both (tests, a superuser)."""
        pool = await asyncpg.create_pool(url, min_size=1, max_size=5)
        store = cls(pool)
        if migrate_url is None:
            await store.migrate(migrations)
        else:
            async with pool.acquire() as conn:
                await check_login_role(conn)
                login = await conn.fetchval("SELECT current_user")
            migrator = await asyncpg.connect(migrate_url)
            try:
                await run_migrations(
                    migrator,
                    migrations,
                    ledger="admin_migrations",
                    lock=_MIGRATION_LOCK,
                    app_role=APP_ROLE,
                    grant_to=login,
                )
            finally:
                await migrator.close()
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute(f"SET LOCAL ROLE {APP_ROLE}")
            await check_app_role(conn)
        return store

    async def migrate(self, migrations: Path) -> None:
        async with self._pool.acquire() as conn:
            await run_migrations(conn, migrations, ledger="admin_migrations", lock=_MIGRATION_LOCK)

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

    async def record_change(self, module: str, changes: dict[str, Any], actor: str) -> None:
        async with self._tenant() as conn:
            await conn.execute(
                "INSERT INTO admin_tenant_settings_changes (module, changes, actor_user_id)"
                " VALUES ($1, $2::jsonb, $3)",
                module,
                json.dumps(changes),
                actor,
            )

    async def recent_changes(self, limit: int) -> list[SettingsChange]:
        async with self._tenant() as conn:
            rows = await conn.fetch(
                "SELECT module, changes, actor_user_id, changed_at"
                " FROM admin_tenant_settings_changes ORDER BY changed_at DESC, id DESC LIMIT $1",
                limit,
            )
        return [
            SettingsChange(
                r["module"], json.loads(r["changes"]), r["actor_user_id"], r["changed_at"]
            )
            for r in rows
        ]

    async def last_changed(self) -> dict[str, datetime]:
        async with self._tenant() as conn:
            rows = await conn.fetch(
                "SELECT module, max(changed_at) AS at FROM admin_tenant_settings_changes"
                " GROUP BY module"
            )
        return {r["module"]: r["at"] for r in rows}

    async def get_profile(self) -> dict[str, Any] | None:
        async with self._tenant() as conn:
            raw = await conn.fetchval("SELECT document FROM admin_tenant_profile")
        return json.loads(raw) if raw is not None else None

    async def set_profile(self, document: dict[str, Any], loaded_by: str | None = None) -> None:
        async with self._tenant() as conn:
            await conn.execute(
                "INSERT INTO admin_tenant_profile (document, loaded_at, loaded_by)"
                " VALUES ($1::jsonb, CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, $2)"
                " ON CONFLICT (tenant_id) DO UPDATE SET document = EXCLUDED.document,"
                " loaded_at = COALESCE(EXCLUDED.loaded_at, admin_tenant_profile.loaded_at),"
                " loaded_by = COALESCE(EXCLUDED.loaded_by, admin_tenant_profile.loaded_by)",
                json.dumps(document),
                loaded_by,
            )

    async def profile_loaded(self) -> tuple[datetime, str] | None:
        async with self._tenant() as conn:
            row = await conn.fetchrow(
                "SELECT loaded_at, loaded_by FROM admin_tenant_profile WHERE loaded_at IS NOT NULL"
            )
        return None if row is None else (row["loaded_at"], row["loaded_by"])

    async def ping(self) -> None:
        await self._pool.fetchval("SELECT 1")

    async def close(self) -> None:
        await self._pool.close()
