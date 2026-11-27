"""The app against a real Postgres (RLS cannot be faked), with a fake admin session, a fake
tenants module, the fake Discord and the lease, status and bind keys in memory.

The tests that need Postgres skip unless CANCCU_DATABASE_URL is set; CI runs them in the
`module (bot)` job.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from canccu_kit import Bus, Health, Outbox, SecretBox, TenantResolver
from canccu_kit.access import TenantContext
from canccu_kit.errors import MissingRight, NotSignedIn
from canccu_kit.rights import Session, session_id_from_cookie
from canccu_kit.testing import MemoryStreamStore, require_test_database_url
from canccu_kit.testing.discord import FakeDiscord
from fakes import FakeAudit, FakeSeries, FakeUsers, MemoryKeys

from canccu_bot.app import create_app
from canccu_bot.config import Hosts, SharedApp
from canccu_bot.db import Db
from canccu_bot.deps import Deps
from canccu_bot.discord_api import DiscordApi
from canccu_bot.status import StatusBoard

URL = os.environ.get("CANCCU_DATABASE_URL")
NOW = datetime(2026, 11, 27, 10, 0, tzinfo=UTC)
SHARED_ID = "100000000000000002"
API = "https://discord.test/api/v10"
SIGNIN = "signin.example.test"
SUPERADMIN = "super.example.test"
HOSTS = {"a.example.test": "ev-a", "b.example.test": "ev-b", "r.example.test": "ev-r"}
TABLES = (
    "bot_connections, bot_bindings, bot_guild_routes, bot_application_routes, bot_outbox,"
    " bot_outbox_tenants"
)
ADMIN = "admin.rights.write"


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
        session = await self.session(cookie)
        if not session.has(right):
            raise MissingRight(f"needs right {right}")
        return session

    async def require_superadmin(self, cookie: str | None) -> Session:
        session = await self.session(cookie)
        if not session.superadmin:
            raise MissingRight("superadmins only")
        return session

    def sign_in(self, user_id: str, *rights: str, superadmin: bool = False) -> dict[str, str]:
        self.sessions[user_id] = Session(
            user_id, user_id, frozenset(rights), NOW + timedelta(1), superadmin
        )
        return {"cookie": f"canccu_session={user_id}"}


@dataclass
class Env:
    db: Db
    rights: FakeRights
    keys: MemoryKeys
    deps: Deps
    app: Any
    discord: FakeDiscord
    streams: MemoryStreamStore
    contexts: dict[str, TenantContext]
    audit: FakeAudit
    users: FakeUsers
    series: FakeSeries

    def client(self, host: str = "a.example.test") -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app, client=("198.51.100.7", 5000)),
            base_url=f"http://{host}",
        )

    def reader(self) -> dict[str, str]:
        return self.rights.sign_in("u_crew", "bot.connection.read")

    def admin(self, user_id: str = "u_org") -> dict[str, str]:
        """The event-admin role through its seam (access.is_event_admin)."""
        return self.rights.sign_in(user_id, ADMIN, "bot.connection.read")

    def events(self, tenant: str) -> list[dict[str, Any]]:
        """The bot's events on the event's stream: type and data."""
        entries = self.streams.streams.get(f"t:{tenant}:events:bot", [])
        out = []
        for _, fields in entries:
            event = json.loads(fields["event"]) if "event" in fields else fields
            out.append({"type": event["type"], "data": event["data"]})
        return out

    async def sql(self, tenant: str, query: str, *args: Any) -> None:
        async with self.db.tenant(tenant) as conn:
            await conn.execute(query, *args)

    async def fetch(self, tenant: str | None, query: str, *args: Any) -> list[Any]:
        if tenant is None:
            async with self.db.platform() as conn:
                return list(await conn.fetch(query, *args))
        async with self.db.tenant(tenant) as conn:
            return list(await conn.fetch(query, *args))

    async def platform_sql(self, query: str, *args: Any) -> None:
        async with self.db.platform() as conn:
            await conn.execute(query, *args)


def resolver(contexts: dict[str, TenantContext]) -> TenantResolver:
    def registry(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.startswith("/internal/tenants/tenants/"):
            tid: str | None = path.rsplit("/", 1)[1]
        else:
            tid = HOSTS.get(request.url.params.get("host", ""))
        if tid is None or tid not in contexts:
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "x"}})
        return httpx.Response(200, json=contexts[tid])

    return TenantResolver(
        "http://tenants",
        platform_hosts=[SIGNIN, SUPERADMIN],
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
    fake = FakeDiscord()
    shared = fake.add_application("Platform Bot", id=SHARED_ID)
    contexts = {t: context(t) for t in HOSTS.values()}
    contexts["ev-r"]["admin_access"] = "restricted"  # organiser paths only from the venue
    streams = MemoryStreamStore()
    audit, users, series = FakeAudit(), FakeUsers(), FakeSeries()
    tenants = resolver(contexts)
    deps = Deps(
        db=db,
        rights=rights,
        board=StatusBoard(keys),
        shared=SharedApp(SHARED_ID, shared.token, shared.client_secret),
        secrets=SecretBox({1: b"s" * 32}, 1),
        discord=DiscordApi(fake.http_client(), API),
        outbox=Outbox(Bus(streams, "bot"), db),
        keys=keys,
        tenants=tenants,
        users=users,
        audit=audit,
        hosts=Hosts(signin=SIGNIN, superadmin=SUPERADMIN, public_url=None),
        series=series,
        now=lambda: NOW,
    )
    app = create_app(deps, Health("bot", "dev", {}), tenants)
    return Env(db, rights, keys, deps, app, fake, streams, contexts, audit, users, series)
