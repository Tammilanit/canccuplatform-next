"""A large event (O1; docs/plans/issue-122.md, D8): 2,000 members and a burst of presence updates
at well over 500 a second, through the real client, router and feeds on the in-process fake
gateway, and every count right in the minute flushed after it.

The live state is the real Valkey when CANCCU_VALKEY_URL is set (CI), else the in-memory one."""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

from canccu_kit.testing.discord import Intents
from conftest import API, SHARED_ID, Env
from fakes import MemoryLive, connector

from canccu_bot.client import DiscordClient
from canccu_bot.counting import Counting
from canccu_bot.feeds import Feeds
from canccu_bot.live import ValkeyLive, clear, live_key
from canccu_bot.router import INTENTS, Directory, Router

T = "ev-a"
MEMBERS = 2000
BURST = 5000
RATE = 500
STATUSES = ("idle", "dnd", "online", "offline")
GAMES = ({"type": 0, "name": "Racing League", "application_id": "77"},)


def presence(guild: str, user: str, status: str, playing: bool) -> dict[str, Any]:
    return {
        "guild_id": guild,
        "user": {"id": user},
        "status": status,
        "activities": list(GAMES) if playing else [],
    }


async def test_2000_members_and_a_burst_of_updates_are_counted_right(env: Env) -> None:
    url = os.environ.get("CANCCU_VALKEY_URL")
    live: Any = ValkeyLive.from_url(url) if url else MemoryLive()
    await clear(live, T)
    env.deps.live = live
    env.contexts[T]["flags"] = {"bot.presence": True, "bot.members": True, "bot.voice": True}
    fake = env.discord
    guild = fake.add_guild("Soak", bots=[SHARED_ID])
    users = [str(200000000000000000 + n) for n in range(MEMBERS)]
    for user in users:
        guild.members[user] = {"user": {"id": user, "username": "member"}}
        guild.presences[user] = presence(guild.id, user, "online", False)
    await env.platform_sql(
        "INSERT INTO bot_guild_routes VALUES ($1, $2, $3)", guild.id, T, SHARED_ID
    )
    directory = Directory(env.deps)
    feeds = Feeds(live, directory.context, env.deps.hidden)
    router = Router(env.deps, SHARED_ID, directory, handlers=feeds.handlers())
    handled = [0]

    async def dispatch(event: str, data: dict[str, Any]) -> None:
        await router.dispatch(event, data)
        handled[0] += event == "PRESENCE_UPDATE"

    client = DiscordClient(
        SHARED_ID,
        fake.applications[SHARED_ID].token,
        http=fake.http_client(),
        api_url=API,
        connector=connector(fake),
        intents=INTENTS,
        on_status=lambda c: None,
        on_dispatch=dispatch,
    )
    router.rest = client.rest
    await client.start()
    try:
        for _ in range(500):
            if T in feeds.served:
                break
            await asyncio.sleep(0.01)
        assert feeds.served == {T: guild.id}

        expected = dict.fromkeys(users, ("online", False))
        started = time.monotonic()
        for k in range(BURST):
            user, status, playing = users[k % MEMBERS], STATUSES[k % 4], k % 3 == 0
            expected[user] = (status, playing)
            await fake.gateway.dispatch(
                SHARED_ID, "PRESENCE_UPDATE", presence(guild.id, user, status, playing)
            )
        # Counted in memory: polling the 2,000-entry hash would slow the loop it measures.
        for _ in range(4000):
            if handled[0] == BURST:
                break
            await asyncio.sleep(0.005)
        elapsed = time.monotonic() - started
        want = {u for u, (s, p) in expected.items() if s != "offline" or p}
        assert set(await live.hgetall(live_key(T, "presence"))) == want
        assert BURST / elapsed >= RATE, f"{BURST / elapsed:.0f} updates a second"

        counting = Counting(env.deps, feeds, directory, SHARED_ID, ready=lambda: True)
        await counting.tick(time.time())
        [row] = await env.fetch(T, "SELECT * FROM bot_counts_minute")
        statuses = [s for s, _ in expected.values()]
        assert (row["members"], row["online"], row["idle"], row["dnd"]) == (
            MEMBERS,
            statuses.count("online"),
            statuses.count("idle"),
            statuses.count("dnd"),
        )
        playing = sum(1 for _, p in expected.values() if p)
        assert f'"players": {playing}' in row["activities"]
    finally:
        await client.stop()
        router.close()
        await clear(live, T)
        if url:
            await live.close()


def test_the_soak_asks_for_the_privileged_intents() -> None:
    assert INTENTS & Intents.GUILD_PRESENCES and INTENTS & Intents.GUILD_MEMBERS
