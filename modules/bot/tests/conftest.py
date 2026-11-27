"""The app against a real Postgres (RLS cannot be faked), with a fake admin session, a fake
tenants module and the lease and status keys in memory.

The tests that need Postgres skip unless CANCCU_DATABASE_URL is set; CI runs them in the
`module (bot)` job.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from canccu_kit import Health, SecretBox, TenantResolver
from canccu_kit.access import TenantContext
from canccu_kit.errors import NotSignedIn
from canccu_kit.rights import Session, session_id_from_cookie
from canccu_kit.testing import require_test_database_url
from fakes import MemoryKeys

from canccu_bot.app import create_app
from canccu_bot.config import SharedApp
from canccu_bot.db import Db
from canccu_bot.deps import Deps
from canccu_bot.status import StatusBoard

URL = os.environ.get("CANCCU_DATABASE_URL")
NOW = datetime(2026, 11, 27, 10, 0, tzinfo=UTC)
SHARED_ID = "100000000000000002"
HOSTS = {"a.example.test": "ev-a", "b.example.test": "ev-b", "r.example.test": "ev-r"}
TABLES = "bot_connections, bot_bindings, bot_guild_routes, bot_application_routes"


def context(tenant_id: str) -> TenantContext:
    return {
        "tenant_id": tenant_id,
        "status": "live",
        "primary_hostname": None,
        "time_zone": "UTC",
        "info_page_mode": "public",
        "membership": "open",
        "admin_access": "internet",
        "venue": None,
        "venue_ip_check": {"enabled": True, "disabled_until": None, "reason": None},
        "flags_version": 0,
        "flags": {},
    }


@dataclass
class FakeRights:
    sessions: dict[str, Session] = field(default_factory=dict)

    async def session(self, cookie: str | None) -> Session:
        found = self.sessions.get(session_id_from_cookie(cookie) or "")
        if found is None:
            raise NotSignedIn("sign in first")
        return found

    async def check(self, cookie: str | None, right: str) -> Session:
        from canccu_kit.errors import MissingRight

        session = await self.session(cookie)
        if not session.has(right):
            raise MissingRight(f"needs right {right}")
        return session

    def sign_in(self, user_id: str, *rights: str) -> dict[str, str]:
        self.sessions[user_id] = Session(user_id, user_id, frozenset(rights), NOW + timedelta(1))
        return {"cookie": f"canccu_session={user_id}"}


@dataclass
class Env:
    db: Db
    rights: FakeRights
    keys: MemoryKeys
    deps: Deps
    app: Any

    def client(self, host: str = "a.example.test") -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app, client=("198.51.100.7", 5000)),
            base_url=f"http://{host}",
        )

    def reader(self) -> dict[str, str]:
        return self.rights.sign_in("u_crew", "bot.connection.read")

    async def sql(self, tenant: str, query: str, *args: Any) -> None:
        async with self.db.tenant(tenant) as conn:
            await conn.execute(query, *args)

    async def platform_sql(self, query: str, *args: Any) -> None:
        async with self.db.platform() as conn:
            await conn.execute(query, *args)


def resolver() -> TenantResolver:
    def registry(request: httpx.Request) -> httpx.Response:
        tid = HOSTS.get(request.url.params.get("host", ""))
        if tid is None:
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "x"}})
        ctx = context(tid)
        if tid == "ev-r":  # organiser paths only from the venue or Tailscale
            ctx["admin_access"] = "restricted"
        return httpx.Response(200, json=ctx)

    return TenantResolver(
        "http://tenants",
        http=httpx.AsyncClient(transport=httpx.MockTransport(registry)),
        cache_seconds=0,
    )


@pytest.fixture
async def db() -> AsyncIterator[Db]:
    if not URL:
        pytest.skip("needs CANCCU_DATABASE_URL")
    await require_test_database_url(URL)  # before connect: it migrates
    db = await Db.connect(URL)
    async with db.pool.acquire() as conn:  # the login role: RLS does not bind it
        await conn.execute(f"TRUNCATE {TABLES}")
    yield db
    await db.close()


@pytest.fixture
async def env(db: Db) -> Env:
    keys = MemoryKeys()
    rights = FakeRights()
    deps = Deps(
        db=db,
        rights=rights,
        board=StatusBoard(keys),
        shared=SharedApp(SHARED_ID, "shared-token", "shared-secret"),
        secrets=SecretBox({1: b"s" * 32}, 1),
    )
    app = create_app(deps, Health("bot", "dev", {}), resolver())
    return Env(db, rights, keys, deps, app)
