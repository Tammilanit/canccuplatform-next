"""One gateway session (a shard): identify, heartbeats, resume, the close codes, and the back-off
from 1 s to at most 5 min (contracts/bot.md, One event's trouble stays its own)."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from canccu_kit.testing.discord import FakeDiscord, Intents
from fakes import connector

from canccu_bot.gateway import Connector, GatewayShard, backoff


class Sleeps:
    """Records each back-off and yields at once, so a test never waits for it."""

    def __init__(self) -> None:
        self.waits: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)
        await asyncio.sleep(0)


class Run:
    def __init__(self, fake: FakeDiscord, token: str, intents: int = Intents.GUILDS, **kw: Any):
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.sleeps = Sleeps()
        self.handler: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None

        async def on_dispatch(event: str, data: dict[str, Any]) -> None:
            self.events.append((event, data))
            if self.handler is not None:
                await self.handler(event, data)

        async def gateway_url() -> str:
            return fake.gateway_url

        conn: Connector = kw.pop("connector", None) or connector(fake)
        self.shard = GatewayShard(
            token,
            intents,
            connector=conn,
            gateway_url=gateway_url,
            on_dispatch=on_dispatch,
            sleep=self.sleeps,
            **kw,
        )
        self.task = asyncio.create_task(self.shard.run())

    async def until(self, check: Callable[[], bool], what: str) -> None:
        for _ in range(500):
            if check():
                return
            await asyncio.sleep(0.002)
        raise AssertionError(f"never {what}; events {[e for e, _ in self.events]}")

    def seen(self, event: str) -> int:
        return sum(1 for e, _ in self.events if e == event)

    async def stop(self) -> None:
        await self.shard.stop()
        await asyncio.wait_for(self.task, 1)


@pytest.fixture
def fake() -> FakeDiscord:
    fake = FakeDiscord()
    fake.gateway.heartbeat_interval_ms = 20
    return fake


async def test_identify_reaches_ready_and_hands_over_dispatches(fake: FakeDiscord) -> None:
    app = fake.add_application("Demo Bot")
    fake.add_guild("G", bots=[app.id])
    run = Run(fake, app.token)
    await run.until(lambda: run.seen("GUILD_CREATE") == 1, "got the guild")
    assert run.shard.status == "ready"
    assert run.shard.bot_user == {"id": app.bot_user_id, "name": "Demo Bot"}
    assert run.shard.session_id is not None
    await run.stop()
    assert fake.gateway.sessions_of(app.id) == 0


async def test_a_dropped_connection_resumes_and_gets_what_it_missed(fake: FakeDiscord) -> None:
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("G", bots=[app.id])
    run = Run(fake, app.token)
    await run.until(lambda: run.shard.status == "ready", "ready")
    await fake.gateway.disconnect(app.id, code=4000)
    await fake.gateway.dispatch(app.id, "GUILD_UPDATE", {"id": guild.id})
    await run.until(lambda: run.seen("GUILD_UPDATE") == 1, "got the missed update")
    await run.until(lambda: run.seen("RESUMED") == 1, "resumed")
    assert run.seen("READY") == 1, "a resume, not a new identify"
    await run.stop()


async def test_unanswered_heartbeats_close_the_zombie_and_resume(fake: FakeDiscord) -> None:
    app = fake.add_application("Demo Bot")
    fake.gateway.ack_heartbeats = False
    run = Run(fake, app.token)
    await run.until(lambda: run.seen("RESUMED") >= 1, "resumed after the zombie")
    await run.stop()


async def test_a_reconnect_request_resumes(fake: FakeDiscord) -> None:
    app = fake.add_application("Demo Bot")
    run = Run(fake, app.token)
    await run.until(lambda: run.shard.status == "ready", "ready")
    await fake.gateway.request_reconnect(app.id)
    await run.until(lambda: run.seen("RESUMED") == 1, "resumed")
    await run.stop()


async def test_an_invalid_session_identifies_anew(fake: FakeDiscord) -> None:
    app = fake.add_application("Demo Bot")
    run = Run(fake, app.token)
    await run.until(lambda: run.shard.status == "ready", "ready")
    first = run.shard.session_id
    await fake.gateway.invalidate(app.id, resumable=False)
    await run.until(lambda: run.seen("READY") == 2, "identified again")
    assert run.shard.session_id != first
    await run.stop()


async def test_a_bad_token_fails_for_good(fake: FakeDiscord) -> None:
    run = Run(fake, "not-a-token")
    await asyncio.wait_for(run.task, 1)
    assert (run.shard.status, run.shard.error_code) == ("failed", "token_invalid")


async def test_missing_privileged_intents_connect_without_them(fake: FakeDiscord) -> None:
    app = fake.add_application("Own Bot", privileged=Intents.NONE)
    run = Run(fake, app.token, Intents.GUILDS | Intents.GUILD_PRESENCES | Intents.GUILD_MEMBERS)
    await run.until(lambda: run.shard.status == "ready", "ready")
    assert run.shard.error_code == "intents_missing"
    assert run.shard.intents == Intents.GUILDS
    await run.stop()


async def test_failures_back_off_from_one_second_and_reset_after_ready(fake: FakeDiscord) -> None:
    app = fake.add_application("Demo Bot")
    real = connector(fake)
    refusals = [3]

    async def flaky(url: str) -> Any:
        if refusals[0] > 0:
            refusals[0] -= 1
            raise OSError("connection refused")
        return await real(url)

    run = Run(fake, app.token, connector=flaky)
    await run.until(lambda: run.shard.status == "ready", "ready")
    assert run.sleeps.waits[:3] == [1, 2, 4]
    refusals[0] = 1
    await fake.gateway.disconnect(app.id, code=1011)
    await run.until(lambda: run.seen("RESUMED") == 1, "resumed")
    assert run.sleeps.waits[3:] == [1, 2]
    await run.stop()


async def test_connecting_says_discord_is_unavailable_after_a_failure(fake: FakeDiscord) -> None:
    async def down(url: str) -> Any:
        raise OSError("connection refused")

    run = Run(fake, "token", connector=down)
    await run.until(lambda: len(run.sleeps.waits) >= 2, "retried")
    assert (run.shard.status, run.shard.error_code) == ("connecting", "discord_unavailable")
    await run.stop()


def test_backoff_doubles_up_to_five_minutes() -> None:
    assert [backoff(n) for n in (0, 1, 2, 8, 9, 30)] == [1, 2, 4, 256, 300, 300]


async def test_a_handler_error_never_stops_the_shard(fake: FakeDiscord) -> None:
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("G", bots=[app.id])
    run = Run(fake, app.token)

    async def broken(event: str, data: dict[str, Any]) -> None:
        if event == "GUILD_UPDATE" and data.get("bad"):
            raise ValueError("bad data from one guild")

    run.handler = broken
    await run.until(lambda: run.shard.status == "ready", "ready")
    await fake.gateway.dispatch(app.id, "GUILD_UPDATE", {"id": guild.id, "bad": True})
    await fake.gateway.dispatch(app.id, "GUILD_UPDATE", {"id": guild.id})
    await run.until(lambda: run.seen("GUILD_UPDATE") == 2, "handled the next update")
    assert run.shard.status == "ready"
    await run.stop()


async def test_identify_names_the_shard(fake: FakeDiscord) -> None:
    app = fake.add_application("Demo Bot")
    run = Run(fake, app.token, shard=(1, 2))
    await run.until(lambda: run.shard.status == "ready", "ready")
    session = next(iter(fake.gateway.sessions.values()))
    assert session.shard == [1, 2]
    await run.stop()


async def test_the_url_asks_for_version_10_json(fake: FakeDiscord) -> None:
    app = fake.add_application("Demo Bot")
    dialled: list[str] = []
    run = Run(fake, app.token, connector=connector(fake, dialled))
    await run.until(lambda: run.shard.status == "ready", "ready")
    assert dialled == [f"{fake.gateway_url}?v=10&encoding=json"]
    await run.stop()


async def test_members_are_requested_only_with_the_members_intent(fake: FakeDiscord) -> None:
    """Op 8 asks for every member of a guild (and their presences with that intent); without the
    members intent Discord refuses a full list, so nothing is sent."""
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("G", bots=[app.id])
    sent: list[dict[str, Any]] = []
    dial = connector(fake)

    async def recording(url: str) -> Any:
        ws = await dial(url)
        real = ws.send

        async def send(payload: dict[str, Any]) -> None:
            sent.append(payload)
            await real(payload)

        ws.send = send  # type: ignore[method-assign]
        return ws

    both = Intents.GUILDS | Intents.GUILD_MEMBERS | Intents.GUILD_PRESENCES
    run = Run(fake, app.token, both, connector=recording)
    await run.until(lambda: run.shard.status == "ready", "ready")
    assert await run.shard.request_members(guild.id) is True
    [asked] = [p["d"] for p in sent if p["op"] == 8]
    assert asked == {"guild_id": guild.id, "query": "", "limit": 0, "presences": True}
    await run.stop()
    sent.clear()
    run = Run(fake, app.token, Intents.GUILDS, connector=recording)
    await run.until(lambda: run.shard.status == "ready", "ready")
    assert await run.shard.request_members(guild.id) is False
    assert [p for p in sent if p["op"] == 8] == []
    await run.stop()
