"""Persistence: settings and the profile record, in Postgres (a memory twin for tests)."""

from __future__ import annotations

import json
from typing import Any, Protocol

import asyncpg
from cp_kit import VersionConflict

SCHEMA = """
CREATE TABLE IF NOT EXISTS admin_settings (
  module text PRIMARY KEY,
  settings_version integer NOT NULL,
  values jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_profile (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  document jsonb NOT NULL
);
"""


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
        self.settings: dict[str, tuple[int, dict[str, Any]]] = {}
        self.profile: dict[str, Any] | None = None
        self.healthy = True

    async def get_settings(self, module: str) -> tuple[int, dict[str, Any]]:
        version, values = self.settings.get(module, (0, {}))
        return version, dict(values)

    async def put_settings(self, module: str, expected_version: int, values: dict[str, Any]) -> int:
        version, _ = self.settings.get(module, (0, {}))
        if version != expected_version:
            raise VersionConflict("settings changed since they were read; read again and retry")
        self.settings[module] = (version + 1, dict(values))
        return version + 1

    async def get_profile(self) -> dict[str, Any] | None:
        return self.profile

    async def set_profile(self, document: dict[str, Any]) -> None:
        self.profile = document

    async def ping(self) -> None:
        if not self.healthy:
            raise ConnectionError("postgres unreachable")

    async def close(self) -> None:
        return None


class PgStore:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    @classmethod
    async def connect(cls, url: str) -> PgStore:
        pool = await asyncpg.create_pool(url, min_size=1, max_size=5)
        async with pool.acquire() as conn:
            await conn.execute(SCHEMA)
        return cls(pool)

    async def get_settings(self, module: str) -> tuple[int, dict[str, Any]]:
        row = await self._pool.fetchrow(
            "SELECT settings_version, values FROM admin_settings WHERE module = $1", module
        )
        if row is None:
            return 0, {}
        return int(row["settings_version"]), json.loads(row["values"])

    async def put_settings(self, module: str, expected_version: int, values: dict[str, Any]) -> int:
        payload = json.dumps(values)
        async with self._pool.acquire() as conn:
            if expected_version == 0:
                row = await conn.fetchrow(
                    "INSERT INTO admin_settings (module, settings_version, values)"
                    " VALUES ($1, 1, $2::jsonb) ON CONFLICT DO NOTHING RETURNING settings_version",
                    module,
                    payload,
                )
            else:
                row = await conn.fetchrow(
                    "UPDATE admin_settings SET settings_version = settings_version + 1,"
                    " values = $3::jsonb WHERE module = $1 AND settings_version = $2"
                    " RETURNING settings_version",
                    module,
                    expected_version,
                    payload,
                )
        if row is None:
            raise VersionConflict("settings changed since they were read; read again and retry")
        return int(row["settings_version"])

    async def get_profile(self) -> dict[str, Any] | None:
        raw = await self._pool.fetchval("SELECT document FROM admin_profile")
        return json.loads(raw) if raw is not None else None

    async def set_profile(self, document: dict[str, Any]) -> None:
        await self._pool.execute(
            "INSERT INTO admin_profile (id, document) VALUES (true, $1::jsonb)"
            " ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document",
            json.dumps(document),
        )

    async def ping(self) -> None:
        await self._pool.fetchval("SELECT 1")

    async def close(self) -> None:
        await self._pool.close()
