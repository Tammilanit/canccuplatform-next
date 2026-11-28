"""Which events a client's feeds serve, wired as main.py wires them (router, feeds, the fake
Discord): a guild bound after its snapshot came is counted, a bot the large guild's snapshot did
not name is never counted, and a client that stops writes no live state of an event it left."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from canccu_kit.testing.discord import FakeGuild
from conftest import API, SHARED_ID, Env
from test_counts import FLAGS, T0, at, game, of

from canccu_bot import lifecycle
from canccu_bot.feeds import Feeds
from canccu_bot.guild import unbind
from canccu_bot.rest import RestClient
from canccu_bot.router import FEEDS, Directory, Handler, Router


class Wired:
    def __init__(self, env: Env) -> None:
        directory = Directory(env.deps)
        self.feeds = Feeds(env.deps, SHARED_ID, directory)
        app = env.discord.applications[SHARED_ID]
        self.feeds.rest = RestClient(app.token, http=env.discord.http_client(), api_url=API)
        self.asked: list[str] = []
        self.feeds.request_members = self._request_members
        handlers: dict[str, Handler] = {k: self.feeds.on for k in (*set(FEEDS.values()), "guild")}
        self.router = Router(env.deps, SHARED_ID, directory, handlers=handlers)
        self.router.rest = self.feeds.rest
        self.feeds.in_guild = self.router.guilds.__contains__

    async def _request_members(self, guild_id: str) -> bool:
        """The client's op 8 (test_gateway.py): recorded; the test sends Discord's answer."""
        self.asked.append(guild_id)
        return True

    async def __call__(self, event: str, data: dict[str, Any]) -> None:
        await self.router.dispatch(event, data)

    async def close(self) -> None:
        self.router.close()
        await self.feeds.close()
        await self.feeds.rest.close()


@pytest.fixture
async def wired(env: Env) -> Any:
    env.contexts["ev-a"]["flags"] = dict.fromkeys(FLAGS, True)
    env.deps.now = lambda: T0
    env.keys.now_ms = int(T0.timestamp() * 1000)
    w = Wired(env)
    yield w
    w.router.close()


def guild_in(env: Env) -> FakeGuild:
    guild = env.discord.add_guild("Demo Community", bots=[SHARED_ID])
    guild.roles[guild.id]["permissions"] = str(1 << 10)  # everyone sees every channel
    guild.channels["c1"] = {"id": "c1", "type": 0, "name": "general", "permission_overwrites": []}
    return guild


async def bind(env: Env, guild: FakeGuild) -> None:
    await env.sql(
        "ev-a",
        "INSERT INTO bot_bindings (guild_id, guild_name, application_id) VALUES ($1, 'G', $2)",
        guild.id,
        SHARED_ID,
    )
    await env.platform_sql(
        "INSERT INTO bot_guild_routes VALUES ($1, 'ev-a', $2)", guild.id, SHARED_ID
    )


def online(guild: FakeGuild, uid: str, *games: str, status: str = "online") -> dict[str, Any]:
    activities = [game(name) for name in games]
    return {"guild_id": guild.id, "user": {"id": uid}, "status": status, "activities": activities}


def live_keys_of(env: Env) -> list[str]:
    return [k for k in env.keys.values if k.startswith("bot:live:ev-a:")]


async def test_a_guild_bound_after_its_snapshot_is_counted(env: Env, wired: Wired) -> None:
    """bind.py needs the bot in the guild before it binds, so the guild's snapshot always came
    before its route: the feeds read its channels and roles and ask for its members instead."""
    guild = guild_in(env)
    await wired("GUILD_CREATE", {**guild.as_payload(), "member_count": 3})
    await bind(env, guild)
    wired.feeds.directory.forget()  # the routes are read again within 10 s
    await wired("PRESENCE_UPDATE", online(guild, "1", "Demo Quest"))
    await at(env, wired.feeds, T0 + timedelta(seconds=61))
    assert wired.asked == [guild.id]
    await wired(
        "GUILD_MEMBERS_CHUNK",
        {
            "guild_id": guild.id,
            "members": [{"user": {"id": i}} for i in ("1", "2")]
            + [{"user": {"id": "9", "bot": True}}],
            "presences": [online(guild, "1", "Demo Quest"), online(guild, "2", status="idle")],
        },
    )
    message = {"guild_id": guild.id, "channel_id": "c1", "type": 0, "author": {"id": "2"}}
    await wired("MESSAGE_CREATE", message)
    await at(env, wired.feeds, T0 + timedelta(seconds=121))
    rows = await env.fetch(
        "ev-a", "SELECT minute, online, idle, messages FROM bot_counts_minute ORDER BY minute"
    )
    assert [tuple(r) for r in rows] == [(T0, 1, 0, 0), (T0 + timedelta(minutes=1), 1, 1, 1)]
    last = of(env, "bot.presence.counted")[-1]
    assert (last["members"], last["online"], last["idle"]) == (2, 1, 1)
    assert of(env, "bot.activities.counted")[-1]["activities"] == [
        {"application_id": "700", "name": "Demo Quest", "players": 1}
    ]
    await wired.close()


async def test_a_route_to_a_guild_the_bot_is_not_in_asks_discord_nothing(
    env: Env, wired: Wired
) -> None:
    """Discord would refuse the reads, and refused requests pause the client: a guild is seeded
    only once its snapshot showed the bot is in it."""
    guild = guild_in(env)
    await bind(env, guild)
    await at(env, wired.feeds, T0 + timedelta(seconds=61))
    assert [r.path for r in env.discord.requests if guild.id in r.path] == []
    assert wired.asked == []
    assert await env.fetch("ev-a", "SELECT * FROM bot_counts_minute") == []
    await wired.close()


@pytest.mark.parametrize("members_feed", [True, False])
async def test_a_bot_offline_at_a_large_guilds_snapshot_is_never_counted(
    env: Env, wired: Wired, members_feed: bool
) -> None:
    """A large guild's snapshot names only who is online, and a presence update's user rarely
    says it is a bot: the members request names the offline bots, kept whatever the members
    feed's flag."""
    env.contexts["ev-a"]["flags"]["bot.members"] = members_feed
    guild = guild_in(env)
    await bind(env, guild)
    snapshot = {
        **guild.as_payload(),
        "large": True,
        "member_count": 300,
        "members": [{"user": {"id": "1"}}],
        "presences": [online(guild, "1")],
    }
    await wired("GUILD_CREATE", snapshot)
    assert wired.asked == [guild.id]
    chunk = [{"user": {"id": "1"}}, {"user": {"id": "9", "bot": True}}]
    await wired("GUILD_MEMBERS_CHUNK", {"guild_id": guild.id, "members": chunk})
    await wired("PRESENCE_UPDATE", online(guild, "9", "Music Bot Tunes"))
    await at(env, wired.feeds, T0 + timedelta(seconds=61))
    [presence] = of(env, "bot.presence.counted")
    assert (presence["members"], presence["online"]) == (299, 1)
    assert of(env, "bot.activities.counted")[0]["activities"] == []
    await wired.close()


@pytest.mark.parametrize("end", ["unbind", "deletion"])
async def test_a_client_that_stops_writes_no_live_state_of_an_event_it_left(
    env: Env, wired: Wired, end: str
) -> None:
    """The pool closes an own client within its tick of an unbind or a deletion, before the
    feeds' minute has seen it: the close drops the state instead of writing it back."""
    guild = guild_in(env)
    await bind(env, guild)
    await wired("GUILD_CREATE", {**guild.as_payload(), "presences": [online(guild, "1")]})
    await wired.feeds.flush()
    assert live_keys_of(env)
    await wired("PRESENCE_UPDATE", online(guild, "2"))  # not yet written behind
    if end == "unbind":
        await unbind(env.deps, "ev-a", "bot_removed", None)
    else:
        await lifecycle.tenant_deleted(env.deps, "ev-a")
        del env.contexts["ev-a"]
    await wired.close()
    assert live_keys_of(env) == []


async def test_a_deleted_event_gets_no_minute_from_a_cached_context(env: Env, wired: Wired) -> None:
    """The minute reads the route and the context fresh: a deletion within the directory's 10 s
    adds no minute row or outbox event that nothing would ever delete."""
    guild = guild_in(env)
    await bind(env, guild)
    await wired("GUILD_CREATE", {**guild.as_payload(), "presences": [online(guild, "1")]})
    await lifecycle.tenant_deleted(env.deps, "ev-a")
    del env.contexts["ev-a"]
    await at(env, wired.feeds, T0 + timedelta(seconds=61))
    assert await env.fetch("ev-a", "SELECT * FROM bot_counts_minute") == []
    assert await env.fetch("ev-a", "SELECT * FROM bot_outbox") == []
    assert live_keys_of(env) == []
    await wired.close()
