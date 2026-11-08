"""The app against a real Postgres (RLS cannot be faked), with a fake admin session and DNS.

Skipped unless CANCCU_DATABASE_URL is set; CI runs them in the `integration (kit)` job.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from canccu_kit import Bus, Health, ServiceIdentity
from canccu_kit.errors import NotSignedIn
from canccu_kit.rights import Session, session_id_from_cookie
from canccu_kit.testing import MemoryStreamStore

from canccu_tenants.app import create_app
from canccu_tenants.caller import Caller
from canccu_tenants.core import Files
from canccu_tenants.db import Db
from canccu_tenants.deps import Deps

URL = os.environ.get("CANCCU_DATABASE_URL")
SERVICE_KEY = b"tenants-tests-service-key-0123456789"
SUPERADMIN_HOST = "super.example.test"
TABLES = "audit, venue_info, tenant_flags, event_admins, hostnames, tenants, venues, users"


@dataclass
class FakeRights:
    """Admin's `GET /api/admin/session`, keyed by the session cookie."""

    sessions: dict[str, Session] = field(default_factory=dict)

    async def session(self, cookie: str | None) -> Session:
        found = self.sessions.get(session_id_from_cookie(cookie) or "")
        if found is None:
            raise NotSignedIn("sign in first")
        return found

    def sign_in(self, user_id: str, *rights: str) -> dict[str, str]:
        expires = datetime.now(UTC) + timedelta(hours=1)
        self.sessions[user_id] = Session(user_id, user_id, frozenset(rights), expires)
        return {"cookie": f"canccu_session={user_id}"}


@dataclass
class Env:
    db: Db
    deps: Deps
    rights: FakeRights
    store: MemoryStreamStore
    txt: dict[str, list[str]]
    app: Any

    def client(self, host: str, app: Any = None) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app or self.app, client=("127.0.0.1", 5000)),
            base_url=f"http://{host}",
        )

    def module(self, caller: str, app: Any = None) -> httpx.AsyncClient:
        """Another module of the stack on the internal address, signing every request."""
        identity = ServiceIdentity(caller, SERVICE_KEY)

        async def sign(request: httpx.Request) -> None:
            request.headers.update(identity.headers("tenants"))

        client = self.client("tenants:8080", app)
        client.event_hooks["request"].append(sign)
        return client

    def app_with(self, *, ip_mode: bool) -> Any:
        return create_app(
            self.deps,
            Health("tenants", "dev", {}),
            [SUPERADMIN_HOST, "signin.example.test"],
            "dev",
            ip_mode,
            service=ServiceIdentity("tenants", SERVICE_KEY),
        )

    def events(self) -> list[tuple[str, str]]:
        """(stream, type) of every published event, in order."""
        return [
            (c.stream, json.loads(v)["type"]) for c in self.store.calls for v in c.fields.values()
        ]


async def make_tenant(
    db: Db, tid: str, host: str, *, status: str = "live", admins: tuple[str, ...] = ()
) -> None:
    """A tenant at a venue that contains the test client's address, so restricted admin access
    lets the tests in."""
    async with db.tenant(tid) as conn:
        await conn.execute(
            "INSERT INTO venues (id, name, addresses) VALUES ($1, $1, '{127.0.0.0/8}')"
            " ON CONFLICT DO NOTHING",
            f"v-{tid}",
        )
        await conn.execute(
            "INSERT INTO tenants (id, name, time_zone, status, venue_id)"
            " VALUES ($1, $1, 'UTC', $2, $3)",
            tid,
            status,
            f"v-{tid}",
        )
        await conn.execute(
            "INSERT INTO hostnames (hostname, tenant_id, kind, status, is_primary)"
            " VALUES ($1, $2, 'custom', 'active', true)",
            host,
            tid,
        )
        for user_id in admins:
            await make_user(conn, user_id)
            await conn.execute("INSERT INTO event_admins (user_id) VALUES ($1)", user_id)


async def make_user(conn: Any, user_id: str, *, superadmin: bool = False, mfa: bool = True) -> None:
    await conn.execute(
        "INSERT INTO users (id, discord_id, name, superadmin, mfa_enabled, audit_ref)"
        " VALUES ($1, $1, $1, $2, $3, 'aud_' || $1) ON CONFLICT (id) DO NOTHING",
        user_id,
        superadmin,
        mfa,
    )


async def sign_in_superadmin(env: Env) -> dict[str, str]:
    async with env.db.platform() as conn:
        await make_user(conn, "u_super", superadmin=True)
    return env.rights.sign_in("u_super")


@pytest.fixture
async def env(tmp_path: Path) -> AsyncIterator[Env]:
    if not URL:
        pytest.skip("needs CANCCU_DATABASE_URL")
    db = await Db.connect(URL)
    async with db.pool.acquire() as conn:  # the login role: RLS and grants do not bind it
        await conn.execute(f"TRUNCATE {TABLES}, platform_audit")
    store = MemoryStreamStore()
    rights = FakeRights()
    txt: dict[str, list[str]] = {}

    async def lookup(name: str) -> list[str]:
        return txt.get(name, [])

    deps = Deps(
        db=db,
        bus=Bus(store, "tenants"),
        caller=Caller(db, rights, SUPERADMIN_HOST),  # type: ignore[arg-type]
        files=Files(str(tmp_path)),
        declared_flags={"bot.stats": False, "screen.pulse": True},
        txt_lookup=lookup,
        platform_domain="example.test",
        reserved_hosts=frozenset({SUPERADMIN_HOST, "signin.example.test"}),
    )
    app = create_app(
        deps,
        Health("tenants", "dev", {}),
        [SUPERADMIN_HOST, "signin.example.test"],
        service=ServiceIdentity("tenants", SERVICE_KEY),
    )
    yield Env(db, deps, rights, store, txt, app)
    await db.close()
