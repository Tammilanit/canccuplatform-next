"""The app against a real Postgres (RLS cannot be faked), with a fake admin session, settings and
tenants module.

Skipped unless CANCCU_DATABASE_URL is set; CI runs them in the `module (notify)` job.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from canccu_kit import (
    Bus,
    Event,
    Health,
    SecretBox,
    ServiceIdentity,
    TenantResolver,
    current_tenant,
    tenant_scope,
)
from canccu_kit.access import TenantContext
from canccu_kit.errors import AdminError, AdminUnavailable, NotSignedIn
from canccu_kit.rights import Session, session_id_from_cookie
from canccu_kit.testing import MemoryStreamStore

from canccu_notify import access, consumer
from canccu_notify.app import create_app
from canccu_notify.db import Db
from canccu_notify.deps import Deps

URL = os.environ.get("CANCCU_DATABASE_URL")
NOW = datetime(2026, 11, 20, 17, 0, tzinfo=UTC)
TOPICS = "notify.topics.write"
KEY = b"k" * 32


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

    def sign_in(self, user_id: str, *rights: str) -> dict[str, str]:
        expires = NOW + timedelta(days=30)
        self.sessions[user_id] = Session(user_id, user_id, frozenset(rights), expires)
        return {"cookie": f"canccu_session={user_id}"}


@dataclass
class FakeSettings:
    """Per tenant, like the kit's SettingsClient; unset keys take the declared default."""

    values: dict[str, dict[str, Any]] = field(default_factory=dict)
    down: bool = False
    writes: list[tuple[str, dict[str, Any], str]] = field(default_factory=list)
    meanwhile: list[dict[str, Any]] = field(default_factory=list)
    """Writes someone else makes in admin just before each of ours: ours is then stale."""

    async def ensure(self) -> None:
        if self.down:
            raise AdminUnavailable("admin unreachable")

    async def load(self) -> None:
        await self.ensure()

    async def write(self, values: dict[str, Any], *, actor_user_id: str) -> None:
        await self.ensure()
        tenant = current_tenant() or ""
        if self.meanwhile:
            self.values.setdefault(tenant, {}).update(self.meanwhile.pop(0))
            raise AdminError("stale", status=409, code="version_conflict")
        self.values.setdefault(tenant, {}).update(values)
        self.writes.append((tenant, values, actor_user_id))

    def get(self, key: str, default: Any = None) -> Any:
        return self.values.get(current_tenant() or "", {}).get(key, default)


@dataclass
class FakeAudit:
    entries: list[tuple[str, str, str, dict[str, str]]] = field(default_factory=list)
    fail: bool = False

    async def append(
        self, tenant_id: str, actor_user_id: str, action: str, target: dict[str, str]
    ) -> None:
        if self.fail:
            raise RuntimeError("tenants unreachable")
        self.entries.append((tenant_id, actor_user_id, action, target))


@dataclass
class FakeTenants:
    """The tenants module's lookup by id (contracts/tenants.md, Another event by its id)."""

    contexts: dict[str, TenantContext]

    async def by_id(self, tenant_id: str) -> TenantContext | None:
        return self.contexts.get(tenant_id)


@dataclass
class Env:
    db: Db
    rights: FakeRights
    settings: FakeSettings
    store: MemoryStreamStore
    contexts: dict[str, TenantContext]
    app: Any
    clock: list[datetime]
    audit: FakeAudit
    deps: Deps

    def client(self, host: str = "a.example.test") -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app, client=("198.51.100.7", 5000)),
            base_url=f"http://{host}",
        )

    def internal(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://notify:8080"
        )

    def admin(self) -> dict[str, str]:
        return self.rights.sign_in("u_org", TOPICS)

    async def register(self, reg: dict[str, Any], module: str | None = None) -> httpx.Response:
        caller = ServiceIdentity(module or reg["owner"], KEY)
        async with self.internal() as c:
            return await c.put(
                f"/internal/notify/topic-types/{reg['key']}",
                json=reg,
                headers=caller.headers("notify"),
            )

    async def emit(
        self, tenant: str, type: str, data: dict[str, Any], *, id: str = "e1", **extra: Any
    ) -> None:
        event = Event(
            id=id,
            type=type,
            version=1,
            time=at(0),
            source=type.split(".")[0],
            data=data,
            tenant=tenant,
            **extra,
        )
        with tenant_scope(tenant):
            await consumer.handle(self.deps, event)


HOSTS = {"a.example.test": "ev-a", "b.example.test": "ev-b"}


@pytest.fixture
async def env() -> AsyncIterator[Env]:
    if not URL:
        pytest.skip("needs CANCCU_DATABASE_URL")
    db = await Db.connect(URL)
    async with db.pool.acquire() as conn:  # the login role: RLS does not bind it
        await conn.execute(
            "TRUNCATE notify_topic_types, notify_topic_type_history, notify_topic_config,"
            " notify_notifications, notify_dedupe, notify_event_state, notify_custom_topics,"
            " notify_check_in_keys, notify_check_ins"
        )
    access.ZONES.clear()
    contexts = {tid: context(tid) for tid in HOSTS.values()}

    def registry(request: httpx.Request) -> httpx.Response:
        tid = HOSTS.get(request.url.params.get("host", ""))
        if tid is None:
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "x"}})
        return httpx.Response(200, json=contexts[tid])

    resolver = TenantResolver(
        "http://tenants",
        http=httpx.AsyncClient(transport=httpx.MockTransport(registry)),
        cache_seconds=0,
    )
    store = MemoryStreamStore()
    rights = FakeRights()
    settings = FakeSettings()
    clock = [NOW]
    audit = FakeAudit()
    d = Deps(
        db=db,
        bus=Bus(store, "notify"),
        rights=rights,
        settings=settings,
        audit=audit,
        secrets=SecretBox({1: b"s" * 32}, 1),
        tenants=FakeTenants(contexts),
        now=lambda: clock[0],
    )
    app = create_app(d, Health("notify", "dev", {}), resolver, ServiceIdentity("notify", KEY))
    yield Env(db, rights, settings, store, contexts, app, clock, audit, d)
    await db.close()


def at(minutes: int) -> str:
    """A time `minutes` after NOW, as the API writes it."""
    return (NOW + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")
