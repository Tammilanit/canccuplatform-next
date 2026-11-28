"""The fake gateway's member requests (op 8): a bot user shows online while another session of its
application is live and not invisible, as Discord folds a user's sessions into one presence."""

from __future__ import annotations

import asyncio
from typing import Any

from canccu_kit.testing.discord import FakeDiscord, Intents

PROBE = Intents.GUILDS | Intents.GUILD_PRESENCES


async def session(fake: FakeDiscord, token: str, *, status: str | None = None) -> Any:
    ws = await fake.gateway.connect(fake.gateway_url)
    await ws.recv()  # hello
    d: dict[str, Any] = {"token": token, "intents": PROBE, "properties": {}}
    if status is not None:
        d["presence"] = {"status": status, "since": None, "activities": [], "afk": False}
    await ws.send({"op": 2, "d": d})
    assert (await ws.recv())["t"] == "READY"
    return ws


async def own_presence(fake: FakeDiscord, ws: Any, guild_id: str, user_id: str) -> Any:
    await ws.send({"op": 8, "d": {"guild_id": guild_id, "user_ids": [user_id], "presences": True}})
    async with asyncio.timeout(2):
        while True:
            message = await ws.recv()
            if message.get("t") == "GUILD_MEMBERS_CHUNK":
                return message["d"]


async def test_the_bot_user_is_offline_with_only_an_invisible_session() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Legacy Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    probe = await session(fake, app.token, status="invisible")
    chunk = await own_presence(fake, probe, guild.id, app.bot_user_id)
    assert chunk["guild_id"] == guild.id
    assert [m["user"]["id"] for m in chunk["members"]] == [app.bot_user_id]
    assert chunk["presences"] == []
    assert chunk["not_found"] == []


async def test_the_bot_user_is_online_while_another_session_holds_the_token() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Legacy Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    held = await session(fake, app.token)
    probe = await session(fake, app.token, status="invisible")
    chunk = await own_presence(fake, probe, guild.id, app.bot_user_id)
    assert chunk["presences"] == [{"user": {"id": app.bot_user_id}, "status": "online"}]
    await held.close(1000)
    for _ in range(10):  # the fake's side sees the close on its next turn
        if fake.gateway.sessions_of(app.id) == 1:
            break
        await asyncio.sleep(0)
    chunk = await own_presence(fake, probe, guild.id, app.bot_user_id)
    assert chunk["presences"] == []


async def test_a_user_outside_the_guild_is_not_found() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Legacy Bot")
    guild = fake.add_guild("Demo Community")
    probe = await session(fake, app.token, status="invisible")
    chunk = await own_presence(fake, probe, guild.id, app.bot_user_id)
    assert chunk["members"] == [] and chunk["not_found"] == [app.bot_user_id]
