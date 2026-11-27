"""One client of one application: its REST side and its gateway, and the one status the
contract shows for both (contracts/bot.md, The event's connection)."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

from canccu_kit.testing.discord import FakeApplication, FakeDiscord, Intents
from fakes import connector

from canccu_bot.client import DiscordClient

API = "https://discord.test/api/v10"


def make(
    fake: FakeDiscord, app_id: str, token: str, **rest: Any
) -> tuple[DiscordClient, list[str]]:
    seen: list[str] = []
    events: list[str] = []

    async def on_dispatch(event: str, data: dict[str, Any]) -> None:
        events.append(event)

    client = DiscordClient(
        app_id,
        token,
        http=fake.http_client(),
        api_url=API,
        connector=connector(fake),
        intents=Intents.GUILDS,
        on_status=lambda c: seen.append(c.status["status"]),
        on_dispatch=on_dispatch,
        rest_options=rest,
    )
    return client, seen


async def until(check: Callable[[], bool], what: str) -> None:
    for _ in range(500):
        if check():
            return
        await asyncio.sleep(0.002)
    raise AssertionError(f"never {what}")


def app_of(fake: FakeDiscord) -> FakeApplication:
    return fake.add_application("Demo Bot")


async def test_a_client_connects_and_reports_ready() -> None:
    fake = FakeDiscord()
    app = app_of(fake)
    client, seen = make(fake, app.id, app.token)
    assert client.status["status"] == "connecting"
    await client.start()
    await until(lambda: client.status["status"] == "ready", "ready")
    assert client.status["error_code"] is None
    assert client.status["since"].endswith("Z")
    assert client.bot_user == {"id": app.bot_user_id, "name": "Demo Bot"}
    assert seen == ["ready"]
    await client.stop()
    assert fake.gateway.sessions_of(app.id) == 0


async def test_a_refused_token_fails_before_any_gateway_session() -> None:
    fake = FakeDiscord()
    client, seen = make(fake, "100000000000000009", "wrong-token")
    await client.start()
    await until(lambda: client.status["status"] == "failed", "failed")
    assert client.status["error_code"] == "token_invalid"
    assert fake.gateway.sessions == {}
    assert seen == ["failed"]
    await client.stop()


async def test_invalid_answers_on_the_rest_side_pause_the_whole_client() -> None:
    fake = FakeDiscord()
    app = app_of(fake)
    client, seen = make(fake, app.id, app.token, breaker_threshold=2)
    await client.start()
    await until(lambda: client.status["status"] == "ready", "ready")
    fake.fail_next(403, times=2)
    for _ in range(2):
        try:
            await client.rest.request("GET", "/users/@me", tenant="ev-a")
        except Exception:
            pass
    assert (client.status["status"], client.status["error_code"]) == ("paused", "invalid_requests")
    assert seen[-1] == "paused"
    await client.stop()


async def test_a_token_dead_on_rest_stops_the_gateway_too() -> None:
    fake = FakeDiscord()
    app = app_of(fake)
    client, _ = make(fake, app.id, app.token)
    await client.start()
    await until(lambda: client.status["status"] == "ready", "ready")
    app.token = "reset-in-the-portal"
    try:
        await client.rest.request("GET", "/users/@me")
    except Exception:
        pass
    await until(lambda: fake.gateway.sessions_of(app.id) == 0, "closed its gateway session")
    assert (client.status["status"], client.status["error_code"]) == ("failed", "token_invalid")
    await client.stop()
