"""The app against a real Postgres (RLS cannot be faked), with a fake admin session, settings and
tenants module.

Skipped unless CANCCU_DATABASE_URL is set; CI runs them in the `module (agenda)` job.
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
from canccu_kit import Bus, Health, TenantResolver, current_tenant
from canccu_kit.access import TenantContext
from canccu_kit.errors import AdminUnavailable, NotSignedIn
from canccu_kit.rights import Session, session_id_from_cookie
from canccu_kit.testing import MemoryStreamStore

from canccu_agenda.app import create_app
from canccu_agenda.db import Db
from canccu_agenda.deps import Deps

URL = os.environ.get("CANCCU_DATABASE_URL")
NOW = datetime(2026, 11, 20, 17, 0, tzinfo=UTC)
WRITE = "agenda.items.write"
CREW = "agenda.crew.read"


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

    async def ensure(self) -> None:
        if self.down:
            raise AdminUnavailable("admin unreachable")

    def get(self, key: str, default: Any = None) -> Any:
        return self.values.get(current_tenant() or "", {}).get(key, default)


@dataclass
class Env:
    db: Db
    rights: FakeRights
    settings: FakeSettings
    store: MemoryStreamStore
    contexts: dict[str, TenantContext]
    app: Any
    clock: list[datetime]

    def client(self, host: str = "a.example.test") -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app, client=("198.51.100.7", 5000)),
            base_url=f"http://{host}",
        )

    def writer(self, *rights: str) -> dict[str, str]:
        return self.rights.sign_in("u_org", WRITE, CREW, *rights)

    def events(self) -> list[dict[str, Any]]:
        return [json.loads(v) for c in self.store.calls for v in c.fields.values()]


HOSTS = {"a.example.test": "ev-a", "b.example.test": "ev-b"}


@pytest.fixture
async def env() -> AsyncIterator[Env]:
    if not URL:
        pytest.skip("needs CANCCU_DATABASE_URL")
    db = await Db.connect(URL)
    async with db.pool.acquire() as conn:  # the login role: RLS does not bind it
        await conn.execute("TRUNCATE agenda_state, agenda_kinds, agenda_items")
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
    d = Deps(
        db=db, bus=Bus(store, "agenda"), rights=rights, settings=settings, now=lambda: clock[0]
    )
    app = create_app(d, Health("agenda", "dev", {}), resolver)
    yield Env(db, rights, settings, store, contexts, app, clock)
    await db.close()


def at(minutes: int) -> str:
    """A time `minutes` after NOW, as the API writes it."""
    return (NOW + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")
