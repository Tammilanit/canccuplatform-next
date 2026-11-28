"""The minute's counts (contracts/bot.md, Counts): flushed once a minute to Postgres with the four
counted events, folded per hour, caught up after a restart without losing a message, and built
without the people who hid; never a person on Postgres."""

from __future__ import annotations

from typing import Any

from canccu_kit import tenant_scope
from conftest import SHARED_ID, Env
from fakes import MemoryLive

from canccu_bot.counting import Counting
from canccu_bot.feeds import Feeds
from canccu_bot.router import Directory

T = "ev-a"
GUILD = "100000000000000501"
VIEW = 1 << 10
ON = {"bot.presence": True, "bot.members": True, "bot.voice": True, "bot.messages": True}
B = 1_800_000_000 - 1_800_000_000 % 3600 + 600  # 10 minutes into an hour


def snapshot() -> dict[str, Any]:
    racing = {"type": 0, "name": "Racing League", "application_id": "77"}
    return {
        "id": GUILD,
        "member_count": 4,
        "roles": [{"id": GUILD, "permissions": str(VIEW)}],
        "channels": [
            {"id": "10", "type": 0, "name": "general"},
            {"id": "30", "type": 2, "name": "Lounge"},
        ],
        "members": [{"user": {"id": u}} for u in ("1", "2", "3")]
        + [{"user": {"id": "9", "bot": True}}],
        "presences": [
            {"user": {"id": "1"}, "status": "online", "activities": [racing]},
            {"user": {"id": "2"}, "status": "online", "activities": [racing]},
            {"user": {"id": "3"}, "status": "idle", "activities": []},
        ],
        "voice_states": [
            {"user_id": "1", "channel_id": "30"},
            {"user_id": "2", "channel_id": "30"},
        ],
    }


class Clock:
    def __init__(self, t: float) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


class Setup:
    def __init__(
        self, env: Env, live: MemoryLive | None = None, hide: frozenset[str] = frozenset()
    ):
        self.env = env
        self.live = live or MemoryLive()
        env.deps.live = self.live
        self.clock = Clock(B - 30)
        self.ready = True

        async def hidden(tenant: str) -> frozenset[str]:
            return hide

        env.deps.hidden = hidden
        self.directory = Directory(env.deps)
        self.feeds = Feeds(self.live, self.directory.context, hidden)
        self.counting = Counting(
            env.deps, self.feeds, self.directory, SHARED_ID, ready=lambda: self.ready
        )

    async def guild(self) -> None:
        with tenant_scope(T):
            await self.feeds.guild("GUILD_CREATE", snapshot())

    async def message(self, author: str = "1", at: float | None = None, **more: Any) -> None:
        self.feeds.clock = Clock(self.clock.t if at is None else at)
        data = {"guild_id": GUILD, "channel_id": "10", "type": 0, "author": {"id": author}}
        with tenant_scope(T):
            await self.feeds.feed("MESSAGE_CREATE", {**data, **more})

    async def tick(self, at: float) -> None:
        await self.counting.tick(at)


async def bind(env: Env) -> None:
    env.contexts[T]["flags"] = dict(ON)
    await env.sql(
        T,
        "INSERT INTO bot_bindings (guild_id, guild_name, application_id) VALUES ($1, 'G', $2)",
        GUILD,
        SHARED_ID,
    )
    await env.platform_sql("INSERT INTO bot_guild_routes VALUES ($1, $2, $3)", GUILD, T, SHARED_ID)


def of(env: Env, kind: str) -> list[dict[str, Any]]:
    return [e["data"] for e in env.events(T) if e["type"] == kind]


async def test_a_minute_is_flushed_with_the_three_counted_events(env: Env) -> None:
    await bind(env)
    s = Setup(env)
    await s.guild()
    await s.message()

    await s.tick(B + 2)

    rows = await env.fetch(T, "SELECT * FROM bot_counts_minute")
    assert len(rows) == 1
    row = rows[0]
    assert (row["members"], row["online"], row["idle"], row["in_voice"], row["messages"]) == (
        3,
        2,
        1,
        2,
        1,
    )
    [presence] = of(env, "bot.presence.counted")
    assert presence == {
        "counted_at": "2027-01-15T08:10:00Z",
        "interval_seconds": 60,
        "members": 3,
        "online": 2,
        "idle": 1,
        "dnd": 0,
        "in_voice": 2,
    }
    assert of(env, "bot.activities.counted")[0]["activities"] == [
        {"application_id": "77", "name": "Racing League", "players": 2}
    ]
    assert of(env, "bot.voice.counted")[0]["rooms"] == [
        {"channel_id": "30", "name": "Lounge", "member_count": 2}
    ]


async def test_a_second_tick_for_the_same_minute_changes_nothing(env: Env) -> None:
    await bind(env)
    s = Setup(env)
    await s.guild()

    await s.tick(B + 2)
    await s.tick(B + 30)

    assert len(await env.fetch(T, "SELECT * FROM bot_counts_minute")) == 1
    assert len(of(env, "bot.presence.counted")) == 1


async def test_a_restart_loses_no_message_and_no_live_state(env: Env) -> None:
    """Messages counted before a restart, in minutes nobody flushed, reach Postgres from the next
    container, which reads the same Valkey."""
    await bind(env)
    s = Setup(env)
    await s.guild()
    await s.tick(B + 2)
    await s.message(at=B + 10)
    await s.message(at=B + 70)
    await s.message(at=B + 130)

    again = Setup(env, live=s.live)  # a new container: nothing in memory, the same Valkey
    again.feeds.served = {T: GUILD}
    await again.tick(B + 182)

    rows = await env.fetch(T, "SELECT minute, messages, online FROM bot_counts_minute ORDER BY 1")
    assert [r["messages"] for r in rows] == [0, 1, 1, 1]
    assert rows[-1]["online"] == 2  # the live state survived: presence still counted


async def test_an_hour_is_folded_once_over_with_the_messages_counted_event(env: Env) -> None:
    await bind(env)
    s = Setup(env)
    await s.guild()
    hour = B - 600
    for n in range(1, 51):
        at = hour + n * 60
        if n % 10 == 0:
            await s.message(at=at - 30)
        if at > hour + 3600:
            break
        await s.tick(at + 2)
    await s.tick(hour + 3600 + 2)

    [folded] = await env.fetch(T, "SELECT * FROM bot_counts_hour")
    assert (folded["online"], folded["online_peak"], folded["messages"]) == (2, 2, 5)
    [games] = await env.fetch(T, "SELECT * FROM bot_activity_hour")
    assert (games["application_id"], games["name"]) == ("77", "Racing League")
    counted = await env.fetch(
        T, "SELECT 1 FROM bot_counts_minute WHERE minute < to_timestamp($1)", hour + 3600
    )
    assert games["player_minutes"] == 2 * len(counted)  # two players each counted minute
    assert of(env, "bot.messages.counted") == [
        {"counted_at": "2027-01-15T09:00:00Z", "interval_seconds": 3600, "messages": 5}
    ]


async def test_the_database_holds_no_author_channel_or_text_after_a_burst(env: Env) -> None:
    await bind(env)
    s = Setup(env)
    await s.guild()
    for n in range(200):
        await s.message(author=f"12345678901234{n:04d}", content=f"secret words {n}")
    await s.tick(B + 2)

    kept = ""
    for table in ("bot_counts_minute", "bot_counts_hour", "bot_activity_hour"):
        kept += repr([dict(r) for r in await env.fetch(T, f"SELECT * FROM {table}")])
    assert "1234567890123" not in kept and "secret" not in kept and "general" not in kept
    assert (await env.fetch(T, "SELECT messages FROM bot_counts_minute"))[0]["messages"] == 200


async def test_someone_hidden_is_dropped_from_every_count(env: Env) -> None:
    """The opt-out seam's wiring (D3): a fake that hides member 2."""
    await bind(env)
    s = Setup(env, hide=frozenset({"2"}))
    await s.guild()
    await s.message(author="2")
    await s.message(author="1")

    await s.tick(B + 2)

    [presence] = of(env, "bot.presence.counted")
    assert (presence["members"], presence["online"], presence["in_voice"]) == (2, 1, 1)
    assert of(env, "bot.activities.counted")[0]["activities"][0]["players"] == 1
    assert of(env, "bot.voice.counted")[0]["rooms"][0]["member_count"] == 1
    assert (await env.fetch(T, "SELECT messages FROM bot_counts_minute"))[0]["messages"] == 1


async def test_a_client_away_counts_messages_but_no_presence(env: Env) -> None:
    await bind(env)
    s = Setup(env)
    await s.guild()
    await s.message()
    s.ready = False

    await s.tick(B + 2)

    [row] = await env.fetch(T, "SELECT online, members, messages FROM bot_counts_minute")
    assert (row["online"], row["members"], row["messages"]) == (None, None, 1)
    assert of(env, "bot.presence.counted") == []


async def test_a_feed_switched_off_is_not_counted_or_emitted(env: Env) -> None:
    await bind(env)
    s = Setup(env)
    await s.guild()
    env.contexts[T]["flags"] = {**ON, "bot.voice": False, "bot.messages": False}
    s.directory.forget(T)
    await s.message()

    await s.tick(B + 2)

    [row] = await env.fetch(T, "SELECT in_voice, messages FROM bot_counts_minute")
    assert (row["in_voice"], row["messages"]) == (None, None)
    assert of(env, "bot.voice.counted") == []
    assert of(env, "bot.presence.counted")[0]["in_voice"] == 0


async def test_an_event_unbound_or_archived_is_no_longer_counted(env: Env) -> None:
    await bind(env)
    s = Setup(env)
    await s.guild()
    env.contexts[T]["status"] = "archived"
    s.directory.forget(T)

    await s.tick(B + 2)

    assert await env.fetch(T, "SELECT * FROM bot_counts_minute") == []
    assert s.feeds.served == {}
