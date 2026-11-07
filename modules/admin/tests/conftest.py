"""Shared fixtures for the sign-in tests: a fake Discord, a clock, and the app behind Caddy."""

from __future__ import annotations

import base64
import hashlib
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from canccu_kit import AdminClient, Bus, Event, Health, RightsChecker
from canccu_kit.rights import Session
from canccu_kit.testing import MemoryStreamStore
from starlette.types import ASGIApp, Receive, Scope, Send

from canccu_admin.app import create_app
from canccu_admin.auth import Auth
from canccu_admin.auth_db import MemoryAuthStore
from canccu_admin.auth_routes import OnEvent
from canccu_admin.db import MemoryStore
from canccu_admin.declarations import load_declarations
from canccu_admin.discord import Discord
from canccu_admin.profile import make_validator
from canccu_admin.service import Service

ROOT = Path(__file__).resolve().parents[3]
PUBLIC = "https://admin.example.test"
CALLBACK = "/admin/sign-in/callback"
START = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


@dataclass
class FakeDiscord:
    """Discord's token and user endpoints; checks the PKCE verifier against the challenge."""

    users: dict[str, dict[str, str]] = field(default_factory=dict)
    challenges: dict[str, str] = field(default_factory=dict)
    token_requests: list[dict[str, list[str]]] = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v10/oauth2/token":
            form = parse_qs(request.content.decode())
            self.token_requests.append(form)
            code = form["code"][0]
            verifier = form["code_verifier"][0].encode()
            digest = base64.urlsafe_b64encode(hashlib.sha256(verifier).digest()).rstrip(b"=")
            if code not in self.users or self.challenges.get(code) != digest.decode():
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": f"at-{code}", "token_type": "Bearer"})
        if request.url.path == "/api/v10/users/@me":
            code = request.headers["authorization"].removeprefix("Bearer at-")
            return httpx.Response(200, json=self.users[code])
        return httpx.Response(404)


@dataclass
class World:
    client: httpx.AsyncClient
    auth: Auth
    store: MemoryAuthStore
    streams: MemoryStreamStore
    discord: FakeDiscord
    clock: list[datetime]
    checker: RightsChecker

    def browser(self, session: str | None = None) -> httpx.AsyncClient:
        """Another browser, optionally holding a session cookie."""
        cookies = {"canccu_session": session} if session else {}
        return httpx.AsyncClient(transport=self.client._transport, base_url=PUBLIC, cookies=cookies)

    async def sign_in(
        self,
        discord_id: str,
        name: str,
        *,
        path: str = "/admin/sign-in",
        data: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Run the browser's round trip; returns the callback response."""
        start = await self.client.post(path, data=data or {})
        assert start.status_code == 303, start.text
        query = parse_qs(urlsplit(start.headers["location"]).query)
        code = f"code-{discord_id}"
        self.discord.users[code] = {"id": discord_id, "username": name, "global_name": name}
        self.discord.challenges[code] = query["code_challenge"][0]
        return await self.client.get(
            "/admin/sign-in/callback", params={"code": code, "state": query["state"][0]}
        )


@pytest.fixture
def world(tmp_path: Path) -> World:
    clock = [START]
    streams = MemoryStreamStore()
    bus = Bus(streams, "admin")
    service = Service(
        MemoryStore(),
        bus,
        make_validator(ROOT / "contracts/profile.schema.json"),
        tmp_path / "event",
        load_declarations(Path(__file__).parents[1] / "declarations"),
        {},
    )
    fake = FakeDiscord()
    discord = Discord(
        "client-1",
        "secret-1",
        f"{PUBLIC}/admin/sign-in/callback",
        httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)),
    )
    store = MemoryAuthStore()
    holder: list[RightsChecker] = []
    auth = Auth(
        store,
        bus,
        PUBLIC,
        discord,
        now=lambda: clock[0],
        on_session_end=lambda session_id: holder[0].forget_session(session_id),
    )

    async def authorize(cookie: str | None, right: str) -> Session:
        return await holder[0].check(cookie, right)

    app = create_app(service, Health("admin", "dev", {}), authorize, auth, holder_event(holder))
    asgi = httpx.ASGITransport(app=caddy(app))
    checker = RightsChecker(
        AdminClient("http://t", httpx.AsyncClient(transport=asgi, base_url="http://t")),
        wall_clock=lambda: clock[0],
    )
    holder.append(checker)
    client = httpx.AsyncClient(transport=asgi, base_url=PUBLIC)
    return World(client, auth, store, streams, fake, clock, checker)


def caddy(app: ASGIApp) -> ASGIApp:
    """Strips /admin from page paths as deploy/Caddyfile does; cookie paths see the full path."""

    async def proxy(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].startswith("/admin/"):
            path = scope["path"].removeprefix("/admin")
            scope = {**scope, "path": path, "raw_path": path.encode()}
        await app(scope, receive, send)

    return proxy


def holder_event(holder: list[RightsChecker]) -> OnEvent:
    async def on_event(event: Event) -> None:
        await holder[0].handle_event(event)

    return on_event


async def first_run_code(world: World, caplog: pytest.LogCaptureFixture) -> str:
    with caplog.at_level(logging.INFO, logger="canccu.admin"):
        code = await world.auth.issue_first_run_code()
    assert code is not None
    assert any(code in r.getMessage() for r in caplog.records)
    return code


async def owner_and_member(world: World, caplog: pytest.LogCaptureFixture) -> tuple[str, str]:
    code = await first_run_code(world, caplog)
    await world.sign_in("2002", "Aino")
    member = world.client.cookies["canccu_session"]
    world.client.cookies.clear()
    await world.sign_in("1001", "Olli", path="/admin/first-run", data={"code": code})
    return world.client.cookies["canccu_session"], member
