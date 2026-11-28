"""The soak (O1, D8): a guild of 2,000 members through the in-process fake gateway, and a burst of
500 presence updates a second for 10 seconds, sent as fast as the fake can. The bot keeps up
(well inside the 10 seconds), every count is right, and the minute is on Postgres."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from datetime import timedelta

from conftest import API, NOW, SHARED_ID, Env
from fakes import connector

from canccu_bot.client import DiscordClient
from canccu_bot.feeds import Feeds
from canccu_bot.router import FEEDS, INTENTS, Directory, Router

MEMBERS = 2000
UPDATES = 500 * 10
STATUSES = ("online", "idle", "dnd", "offline")


async def until(check: Callable[[], bool], what: str, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while not check():
        if time.monotonic() > deadline:
            raise AssertionError(f"never {what}")
        await asyncio.sleep(0.01)


async def test_two_thousand_members_and_a_burst_of_updates(env: Env) -> None:
    app = env.discord.applications[SHARED_ID]
    guild = env.discord.add_guild("Soak Community", bots=[SHARED_ID])
    for i in range(MEMBERS):
        uid = str(200000000000000000 + i)
        guild.members[uid] = {"user": {"id": uid}, "roles": []}
    await env.platform_sql(
        "INSERT INTO bot_guild_routes VALUES ($1, 'ev-a', $2)", guild.id, SHARED_ID
    )
    env.contexts["ev-a"]["flags"] = dict.fromkeys(set(FEEDS.values()), True)
    directory = Directory(env.deps)
    feeds = Feeds(env.deps, SHARED_ID, directory)
    handled = 0

    async def counting(event: str, data: dict[str, object]) -> None:
        nonlocal handled
        await feeds.on(event, data)
        handled += 1

    handlers = dict.fromkeys([*set(FEEDS.values()), "guild"], counting)
    router = Router(env.deps, SHARED_ID, directory, handlers=handlers)
    client = DiscordClient(
        SHARED_ID,
        app.token,
        http=env.discord.http_client(),
        api_url=API,
        connector=connector(env.discord),
        intents=INTENTS,
        on_status=lambda c: None,
        on_dispatch=router.dispatch,
    )
    await client.start()
    try:
        await until(lambda: handled == 1, "saw the guild", 10)
        ids = list(guild.members)
        started = time.monotonic()
        for n in range(UPDATES):
            uid = ids[n % MEMBERS]
            status = STATUSES[n % len(STATUSES)]
            presence = {"guild_id": guild.id, "user": {"id": uid}, "status": status}
            await env.discord.gateway.dispatch(SHARED_ID, "PRESENCE_UPDATE", presence)
        await until(lambda: handled == 1 + UPDATES, "handled the burst", 10)
        assert time.monotonic() - started < 10
    finally:
        await client.stop()
        router.close()
    # Member i's last update is n = i + 2000k, so its status is STATUSES[i % 4].
    online = sum(1 for i in range(MEMBERS) if STATUSES[i % 4] == "online")
    env.deps.now = lambda: NOW + timedelta(seconds=61)
    await feeds.tick()
    [row] = await env.fetch("ev-a", "SELECT members, online, idle, dnd FROM bot_counts_minute")
    assert tuple(row) == (MEMBERS, online, MEMBERS // 4, MEMBERS // 4)
