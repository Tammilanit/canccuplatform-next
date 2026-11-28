"""Routing gateway events by guild (contracts/bot.md, Routing; Privileged intents and data per
event): only a guild bound for the client's application reaches its event, a feed whose flag is
off is dropped before any handler, the shared bot leaves guilds no event chose, and a guild that
removes the bot ends its binding."""

from __future__ import annotations

import asyncio
from typing import Any

from canccu_kit import current_tenant
from conftest import API, SHARED_ID, Env

from canccu_bot.rest import RestClient
from canccu_bot.router import Directory, Router
from canccu_bot.texts import text

GUILD = "100000000000000501"


class Recorder:
    def __init__(self) -> None:
        self.seen: list[tuple[str | None, str, dict[str, Any]]] = []

    async def __call__(self, event: str, data: dict[str, Any]) -> None:
        self.seen.append((current_tenant(), event, data))


class Clock:
    t = 1000.0

    def __call__(self) -> float:
        return self.t


def router(
    env: Env, app_id: str = SHARED_ID, handlers: dict[str, Any] | None = None
) -> tuple[Router, list[float]]:
    waits: list[float] = []
    gate = asyncio.Event()

    async def sleep(seconds: float) -> None:
        waits.append(seconds)
        await gate.wait()

    r = Router(env.deps, app_id, Directory(env.deps, Clock()), handlers=handlers, sleep=sleep)
    app = env.discord.applications[app_id]
    r.rest = RestClient(app.token, http=env.discord.http_client(), api_url=API)
    r.gate = gate  # type: ignore[attr-defined]
    return r, waits


async def bind(env: Env, tenant: str = "ev-a", guild: str = GUILD, app: str = SHARED_ID) -> None:
    await env.sql(
        tenant,
        "INSERT INTO bot_bindings (guild_id, guild_name, application_id) VALUES ($1, 'G', $2)",
        guild,
        app,
    )
    await env.platform_sql("INSERT INTO bot_guild_routes VALUES ($1, $2, $3)", guild, tenant, app)


async def test_a_feed_reaches_its_event_only_with_its_flag_on(env: Env) -> None:
    await bind(env)
    seen = Recorder()
    r, _ = router(env, handlers={"bot.presence": seen, "bot.voice": seen})
    env.contexts["ev-a"]["flags"] = {"bot.presence": True, "bot.voice": False}
    await r.dispatch("PRESENCE_UPDATE", {"guild_id": GUILD, "user": {"id": "1"}})
    await r.dispatch("VOICE_STATE_UPDATE", {"guild_id": GUILD, "user_id": "1"})
    assert [(t, e) for t, e, _ in seen.seen] == [("ev-a", "PRESENCE_UPDATE")]


async def test_a_guild_snapshot_carries_only_the_feeds_that_are_on(env: Env) -> None:
    """GUILD_CREATE holds members, presences and voice states: each part is dropped before the
    handler when its feed's flag is off, like the feed's own events."""
    await bind(env)
    seen = Recorder()
    r, _ = router(env, handlers={"guild": seen})
    env.contexts["ev-a"]["flags"] = {"bot.presence": True, "bot.members": False}
    snapshot = {
        "id": GUILD,
        "member_count": 3,
        "channels": [{"id": "c1"}],
        "members": [{"user": {"id": "1"}}],
        "presences": [{"user": {"id": "1"}, "status": "online"}],
        "voice_states": [{"user_id": "1", "channel_id": "c1"}],
    }
    await r.dispatch("GUILD_CREATE", snapshot)
    [(tenant, event, data)] = seen.seen
    assert (tenant, event) == ("ev-a", "GUILD_CREATE")
    assert data["presences"] and data["channels"] and data["member_count"] == 3
    assert "members" not in data and "voice_states" not in data


async def test_a_dropped_feed_still_names_its_bots(env: Env) -> None:
    """Bots are no people and no feed's data: a member event or a voice state of a bot reaches
    the counts as its id alone when its feed is off, so no count ever takes the bot in; a
    person's event is dropped whole, and a members chunk loses its parts like the snapshot."""
    await bind(env)
    seen = Recorder()
    r, _ = router(env, handlers={"guild": seen, "bot.presence": seen})
    env.contexts["ev-a"]["flags"] = {"bot.presence": True}
    bot = {"id": "9", "bot": True}
    await r.dispatch("GUILD_MEMBER_ADD", {"guild_id": GUILD, "user": bot, "nick": "x"})
    await r.dispatch("GUILD_MEMBER_ADD", {"guild_id": GUILD, "user": {"id": "1"}})
    voice = {"guild_id": GUILD, "user_id": "8", "channel_id": "v1"}
    await r.dispatch("VOICE_STATE_UPDATE", {**voice, "member": {"user": {"id": "8", "bot": True}}})
    await r.dispatch("GUILD_MEMBER_REMOVE", {"guild_id": GUILD, "user": bot})
    chunk = {
        "guild_id": GUILD,
        "members": [{"user": {"id": "1"}}, {"user": {"id": "7", "bot": True}}],
        "presences": [{"user": {"id": "1"}, "status": "online"}],
    }
    await r.dispatch("GUILD_MEMBERS_CHUNK", chunk)
    assert [(e, d) for _, e, d in seen.seen] == [
        ("BOTS_SEEN", {"bots": ["9"]}),
        ("BOTS_SEEN", {"bots": ["8"]}),
        (
            "GUILD_MEMBERS_CHUNK",
            {"guild_id": GUILD, "presences": chunk["presences"], "bots": ["7"]},
        ),
    ]


async def test_channel_and_role_changes_reach_the_guild_handler(env: Env) -> None:
    await bind(env)
    seen = Recorder()
    r, _ = router(env, handlers={"guild": seen})
    for event in ("CHANNEL_CREATE", "CHANNEL_UPDATE", "CHANNEL_DELETE", "THREAD_CREATE"):
        await r.dispatch(event, {"guild_id": GUILD, "id": "c1"})
    await r.dispatch("GUILD_ROLE_UPDATE", {"guild_id": GUILD, "role": {"id": GUILD}})
    await r.dispatch("CHANNEL_CREATE", {"guild_id": "100000000000000999", "id": "c2"})
    assert len(seen.seen) == 5


async def test_an_unbound_guilds_snapshot_reaches_no_handler(env: Env) -> None:
    seen = Recorder()
    r, _ = router(env, handlers={"guild": seen})
    await r.dispatch("GUILD_CREATE", {"id": GUILD, "members": []})
    assert seen.seen == []
    r.close()


async def test_a_flag_the_event_does_not_carry_is_off(env: Env) -> None:
    await bind(env)
    seen = Recorder()
    r, _ = router(env, handlers={"bot.members": seen})
    await r.dispatch("GUILD_MEMBER_UPDATE", {"guild_id": GUILD, "user": {"id": "1"}})
    assert seen.seen == []


async def test_nothing_of_an_unbound_guild_or_another_application_is_handled(env: Env) -> None:
    other = env.discord.add_application("Own Bot")
    await bind(env, app=other.id)
    seen = Recorder()
    r, _ = router(env, handlers={"bot.messages": seen})
    env.contexts["ev-a"]["flags"] = {"bot.messages": True}
    await r.dispatch("MESSAGE_CREATE", {"guild_id": GUILD, "id": "9"})
    await r.dispatch("MESSAGE_CREATE", {"guild_id": "100000000000000999", "id": "9"})
    await r.dispatch("MESSAGE_CREATE", {"id": "9"})  # a DM is no feed
    assert seen.seen == []


async def test_an_archived_event_reads_nothing_more(env: Env) -> None:
    await bind(env)
    seen = Recorder()
    r, _ = router(env, handlers={"bot.presence": seen})
    env.contexts["ev-a"]["flags"] = {"bot.presence": True}
    env.contexts["ev-a"]["status"] = "archived"
    await r.dispatch("PRESENCE_UPDATE", {"guild_id": GUILD})
    assert seen.seen == []


async def test_a_handlers_error_stays_with_its_guild(env: Env) -> None:
    await bind(env)
    await bind(env, "ev-b", "100000000000000502")
    for t in ("ev-a", "ev-b"):
        env.contexts[t]["flags"] = {"bot.presence": True}
    seen = Recorder()

    async def flaky(event: str, data: dict[str, Any]) -> None:
        if data["guild_id"] == GUILD:
            raise RuntimeError("bad data")
        await seen(event, data)

    r, _ = router(env, handlers={"bot.presence": flaky})
    await r.dispatch("PRESENCE_UPDATE", {"guild_id": GUILD})
    await r.dispatch("PRESENCE_UPDATE", {"guild_id": "100000000000000502"})
    assert [t for t, _, _ in seen.seen] == ["ev-b"]


async def test_an_interaction_in_an_unbound_guild_gets_a_private_answer(env: Env) -> None:
    r, _ = router(env)
    await r.dispatch(
        "INTERACTION_CREATE", {"id": "100000000000000801", "token": "t1", "guild_id": GUILD}
    )
    [(interaction, body)] = env.discord.interaction_answers
    assert interaction == "100000000000000801"
    # The product owner's final wording (mockup 07): what to do, and who can do it.
    said = (
        "This server is not connected to an event yet. Ask an event admin to connect it on the"
        " event's Discord page."
    )
    assert body == {
        "type": 4,
        "data": {"content": said, "flags": 64, "allowed_mentions": {"parse": []}},
    }


async def test_the_no_answers_speak_the_persons_language(env: Env) -> None:
    r, _ = router(env)
    await r.dispatch(
        "INTERACTION_CREATE",
        {"id": "100000000000000805", "token": "t1", "guild_id": GUILD, "locale": "fi"},
    )
    said = env.discord.interaction_answers[-1][1]["data"]["content"]
    assert said.startswith("Tätä palvelinta ei ole vielä yhdistetty tapahtumaan.")


async def test_a_dm_to_the_shared_bot_gets_a_note_and_an_own_bots_goes_to_its_event(
    env: Env,
) -> None:
    r, _ = router(env)
    await r.dispatch("INTERACTION_CREATE", {"id": "100000000000000802", "token": "t"})
    assert env.discord.interaction_answers[-1][1]["data"]["content"] == text("outside", None)
    app = env.discord.add_application("Own Bot")
    await env.platform_sql("INSERT INTO bot_application_routes VALUES ($1, 'ev-b')", app.id)
    seen = Recorder()
    own, _ = router(env, app.id, handlers={"interaction": seen})
    await own.dispatch("INTERACTION_CREATE", {"id": "100000000000000803", "token": "t"})
    assert [t for t, _, _ in seen.seen] == ["ev-b"]


async def test_an_interaction_of_an_archived_event_says_it_ended(env: Env) -> None:
    await bind(env)
    env.contexts["ev-a"]["status"] = "archived"
    r, _ = router(env)
    await r.dispatch(
        "INTERACTION_CREATE", {"id": "100000000000000804", "token": "t", "guild_id": GUILD}
    )
    assert env.discord.interaction_answers[-1][1]["data"]["content"] == text("ended", "en-GB")


async def test_the_shared_bot_leaves_an_unbound_guild_after_15_minutes(env: Env) -> None:
    guild = env.discord.add_guild("Invited by a plain link", bots=[SHARED_ID])
    r, waits = router(env)
    await r.dispatch("GUILD_CREATE", {"id": guild.id})
    await asyncio.sleep(0)
    assert waits == [900]
    r.gate.set()  # type: ignore[attr-defined]
    await asyncio.sleep(0.05)
    assert SHARED_ID not in guild.bots


async def test_a_guild_bound_meanwhile_is_not_left(env: Env) -> None:
    guild = env.discord.add_guild("Bound within the 15 minutes", bots=[SHARED_ID])
    r, _ = router(env)
    await r.dispatch("GUILD_CREATE", {"id": guild.id})
    await bind(env, guild=guild.id)
    r.gate.set()  # type: ignore[attr-defined]
    await asyncio.sleep(0.05)
    assert SHARED_ID in guild.bots


async def test_an_own_bot_stays_in_an_unbound_guild(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    r, waits = router(env, app.id)
    await r.dispatch("GUILD_CREATE", {"id": GUILD})
    await asyncio.sleep(0)
    assert waits == []


async def test_a_guild_that_removes_the_bot_ends_its_binding(env: Env) -> None:
    await bind(env)
    r, _ = router(env)
    await r.dispatch("GUILD_DELETE", {"id": GUILD, "unavailable": True})
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_bindings") != []
    await r.dispatch("GUILD_DELETE", {"id": GUILD})
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_bindings") == []
    assert env.events("ev-a")[-1]["data"] == {
        "guild_id": GUILD,
        "reason": "bot_removed",
        "actor_user_id": None,
    }
    assert env.audit.entries[-1]["actor_user_id"] is None
