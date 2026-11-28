"""Counts, never people (D7) and chat activity (D6 B): the minute's counts from the live state
and the message counters, on Postgres per minute and folded per hour with player-minutes, the
four counted events, the seam `hidden_discord_ids`, a restart, and retention."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from canccu_kit import tenant_scope
from canccu_kit.testing import tenant_event
from conftest import SHARED_ID, Env

from canccu_bot import lifecycle
from canccu_bot.feeds import Feeds
from canccu_bot.router import FEEDS, Directory

GUILD = "100000000000000501"
FLAGS = sorted(set(FEEDS.values()))
T0 = datetime(2026, 11, 27, 10, 0, tzinfo=UTC)


def snapshot() -> dict[str, Any]:
    everyone = str(1 << 10)
    return {
        "id": GUILD,
        "member_count": 5,
        "roles": [{"id": GUILD, "permissions": everyone}],
        "channels": [
            {"id": "general", "type": 0, "name": "general", "permission_overwrites": []},
            {"id": "v1", "type": 2, "name": "Lobby", "permission_overwrites": []},
        ],
        "members": [{"user": {"id": str(i)}} for i in range(1, 5)]
        + [{"user": {"id": "9", "bot": True}}],
        "presences": [
            {"user": {"id": "1"}, "status": "online", "activities": [game("Demo Quest")]},
            {"user": {"id": "2"}, "status": "online", "activities": [game("Demo Quest")]},
            {"user": {"id": "3"}, "status": "idle", "activities": []},
        ],
        "voice_states": [
            {"user_id": "1", "channel_id": "v1"},
            {"user_id": "2", "channel_id": "v1"},
        ],
    }


def game(name: str) -> dict[str, Any]:
    return {"name": name, "type": 0, "application_id": "700"}


def message(author: str, channel: str = "general") -> dict[str, Any]:
    return {
        "id": "1",
        "guild_id": GUILD,
        "channel_id": channel,
        "type": 0,
        "author": {"id": author},
        "content": "a secret line",
    }


@pytest.fixture
async def feeds(env: Env) -> Feeds:
    env.contexts["ev-a"]["flags"] = dict.fromkeys(FLAGS, True)
    await env.platform_sql("INSERT INTO bot_guild_routes VALUES ($1, 'ev-a', $2)", GUILD, SHARED_ID)
    env.deps.now = lambda: T0
    env.keys.now_ms = int(T0.timestamp() * 1000)
    return new_feeds(env)


def new_feeds(env: Env) -> Feeds:
    return Feeds(env.deps, SHARED_ID, Directory(env.deps))


async def feed(f: Feeds, event: str, data: dict[str, Any]) -> None:
    with tenant_scope("ev-a"):
        await f.on(event, data)


async def at(env: Env, f: Feeds, moment: datetime) -> None:
    env.deps.now = lambda: moment
    env.keys.now_ms = int(moment.timestamp() * 1000)
    await f.tick()


def of(env: Env, kind: str) -> list[dict[str, Any]]:
    return [e["data"] for e in env.events("ev-a") if e["type"] == kind]


async def test_the_minute_is_counted_and_published(env: Env, feeds: Feeds) -> None:
    await at(env, feeds, T0)
    await feed(feeds, "GUILD_CREATE", snapshot())
    for author in ("1", "2"):
        await feed(feeds, "MESSAGE_CREATE", message(author))
    await at(env, feeds, T0 + timedelta(seconds=61))
    rows = await env.fetch("ev-a", "SELECT * FROM bot_counts_minute")
    assert [(r["minute"], r["online"], r["messages"]) for r in rows] == [(T0, 2, 2)]
    [presence] = of(env, "bot.presence.counted")
    assert presence == {
        "counted_at": "2026-11-27T10:01:01Z",
        "interval_seconds": 60,
        "members": 4,
        "online": 2,
        "idle": 1,
        "dnd": 0,
        "in_voice": 2,
    }
    [activities] = of(env, "bot.activities.counted")
    assert activities["activities"] == [
        {"application_id": "700", "name": "Demo Quest", "players": 2}
    ]
    [voice] = of(env, "bot.voice.counted")
    assert voice["rooms"] == [{"channel_id": "v1", "name": "Lobby", "member_count": 2}]
    assert voice["interval_seconds"] == 60


async def test_a_minute_is_counted_once(env: Env, feeds: Feeds) -> None:
    await feed(feeds, "GUILD_CREATE", snapshot())
    await at(env, feeds, T0 + timedelta(seconds=61))
    await at(env, feeds, T0 + timedelta(seconds=75))
    await new_feeds(env).tick()  # another container after a lease handover
    assert len(await env.fetch("ev-a", "SELECT * FROM bot_counts_minute")) == 1
    assert len(of(env, "bot.presence.counted")) == 1


async def test_the_hour_is_folded_with_player_minutes(env: Env, feeds: Feeds) -> None:
    await feed(feeds, "GUILD_CREATE", snapshot())
    for minute in range(3):
        await feed(feeds, "MESSAGE_CREATE", message("1"))
        await at(env, feeds, T0 + timedelta(minutes=minute + 1, seconds=1))
    await feed(feeds, "PRESENCE_UPDATE", {"user": {"id": "2"}, "status": "offline"})
    await at(env, feeds, T0 + timedelta(minutes=4, seconds=1))
    await at(env, feeds, T0 + timedelta(hours=1, seconds=5))  # counts 10:59, folds 10:00
    [hour] = await env.fetch("ev-a", "SELECT * FROM bot_counts_hour")
    assert hour["hour"] == T0
    assert hour["messages"] == 3
    # Online 2, 2, 2, then 1 at 10:03 and 10:59.
    assert hour["online_max"] == 2 and float(hour["online"]) == pytest.approx(8 / 5, abs=0.01)
    [played] = await env.fetch("ev-a", "SELECT * FROM bot_activity_hour")
    assert (played["name"], played["player_minutes"], played["peak_players"]) == (
        "Demo Quest",
        8,
        2,
    )
    assert of(env, "bot.messages.counted") == [
        {"counted_at": "2026-11-27T10:00:00Z", "interval_seconds": 3600, "messages": 3}
    ]


async def test_a_feed_that_is_off_is_neither_counted_nor_kept(env: Env, feeds: Feeds) -> None:
    await feed(feeds, "GUILD_CREATE", snapshot())
    await feed(feeds, "MESSAGE_CREATE", message("1"))
    env.contexts["ev-a"]["flags"]["bot.voice"] = False
    env.contexts["ev-a"]["flags"]["bot.messages"] = False
    await at(env, feeds, T0 + timedelta(seconds=61))
    assert of(env, "bot.voice.counted") == []
    [row] = await env.fetch("ev-a", "SELECT * FROM bot_counts_minute")
    assert row["in_voice"] is None and row["messages"] is None
    assert of(env, "bot.presence.counted")[0]["in_voice"] == 0
    assert not any(":voice" in k for k in env.keys.values)


async def test_someone_hidden_is_dropped_from_every_count(env: Env, feeds: Feeds) -> None:
    """The seam's wiring (D3): a fake `hidden_discord_ids` that hides member 2."""

    async def hidden(tenant: str) -> frozenset[str]:
        return frozenset({"2"}) if tenant == "ev-a" else frozenset()

    env.deps.hidden = hidden
    await feed(feeds, "GUILD_CREATE", snapshot())
    await feed(feeds, "MESSAGE_CREATE", message("1"))
    await feed(feeds, "MESSAGE_CREATE", message("2"))
    await at(env, feeds, T0 + timedelta(seconds=61))
    [presence] = of(env, "bot.presence.counted")
    assert (presence["members"], presence["online"], presence["in_voice"]) == (3, 1, 1)
    assert of(env, "bot.activities.counted")[0]["activities"][0]["players"] == 1
    assert of(env, "bot.voice.counted")[0]["rooms"][0]["member_count"] == 1
    await at(env, feeds, T0 + timedelta(hours=1, seconds=1))
    assert of(env, "bot.messages.counted")[0]["messages"] == 1


async def test_the_database_holds_no_author_channel_or_text(env: Env, feeds: Feeds) -> None:
    await feed(feeds, "GUILD_CREATE", snapshot())
    for i in range(200):
        await feed(feeds, "MESSAGE_CREATE", message(str(1 + i % 4)))
    await at(env, feeds, T0 + timedelta(seconds=61))
    await at(env, feeds, T0 + timedelta(hours=1, seconds=1))
    dump = ""
    for table in ("bot_counts_minute", "bot_counts_hour", "bot_activity_hour"):
        rows = await env.fetch("ev-a", f"SELECT to_jsonb(t) AS j FROM {table} t")
        assert rows
        dump += "".join(str(r["j"]) for r in rows)
    outbox = await env.fetch("ev-a", "SELECT event FROM bot_outbox")
    dump += "".join(r["event"] for r in outbox)
    assert "general" not in dump and "secret" not in dump and "author" not in dump
    assert of(env, "bot.messages.counted")[0]["messages"] == 200


async def test_a_restart_loses_no_count_and_no_live_state(env: Env, feeds: Feeds) -> None:
    await at(env, feeds, T0)
    await feed(feeds, "GUILD_CREATE", snapshot())
    await feed(feeds, "MESSAGE_CREATE", message("1"))
    await feeds.close()  # a stop: what was not yet written behind goes now
    again = new_feeds(env)  # no GUILD_CREATE yet
    await feed(again, "MESSAGE_CREATE", message("3"))
    await at(env, again, T0 + timedelta(seconds=61))
    [presence] = of(env, "bot.presence.counted")
    assert presence["online"] == 2 and presence["in_voice"] == 2
    [row] = await env.fetch("ev-a", "SELECT messages FROM bot_counts_minute")
    assert row["messages"] == 2


async def test_minutes_missed_while_down_keep_their_messages(env: Env, feeds: Feeds) -> None:
    await at(env, feeds, T0)
    await feed(feeds, "GUILD_CREATE", snapshot())
    await feed(feeds, "MESSAGE_CREATE", message("1"))
    await at(env, feeds, T0 + timedelta(minutes=4, seconds=1))
    rows = await env.fetch(
        "ev-a", "SELECT minute, online, messages FROM bot_counts_minute ORDER BY minute"
    )
    assert [(r["minute"], r["online"], r["messages"]) for r in rows] == [
        (T0, None, 1),
        (T0 + timedelta(minutes=3), 2, 0),
    ]


async def test_archiving_drops_the_live_state_and_keeps_the_counts(env: Env, feeds: Feeds) -> None:
    await feed(feeds, "GUILD_CREATE", snapshot())
    await at(env, feeds, T0 + timedelta(seconds=61))
    await feeds.flush()
    assert any(k.startswith("bot:live:ev-a:") for k in env.keys.values)
    env.contexts["ev-a"]["status"] = "archived"
    event = tenant_event("ev-a", "tenants.status.changed", {"from": "live", "to": "archived"})
    await lifecycle.on_tenant(env.deps, feeds.directory, event)  # the container's one directory
    assert not any(k.startswith("bot:live:ev-a:") for k in env.keys.values)
    await at(env, feeds, T0 + timedelta(seconds=125))
    assert not any(k.startswith("bot:live:ev-a:") for k in env.keys.values)
    assert len(await env.fetch("ev-a", "SELECT * FROM bot_counts_minute")) == 1


async def test_an_unbound_guild_loses_its_live_state(env: Env, feeds: Feeds) -> None:
    await feed(feeds, "GUILD_CREATE", snapshot())
    await feeds.flush()
    await env.platform_sql("DELETE FROM bot_guild_routes")
    await at(env, feeds, T0 + timedelta(seconds=61))
    assert not any(k.startswith("bot:live:ev-a:") for k in env.keys.values)
    assert await env.fetch("ev-a", "SELECT * FROM bot_counts_minute") == []


async def test_a_deleted_event_loses_its_counts(env: Env, feeds: Feeds) -> None:
    await feed(feeds, "GUILD_CREATE", snapshot())
    await at(env, feeds, T0 + timedelta(seconds=61))
    await at(env, feeds, T0 + timedelta(hours=1, seconds=1))
    await lifecycle.tenant_deleted(env.deps, "ev-a")
    for table in ("bot_counts_minute", "bot_counts_hour", "bot_activity_hour"):
        assert await env.fetch("ev-a", f"SELECT * FROM {table}") == []
