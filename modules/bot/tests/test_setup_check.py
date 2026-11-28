"""The check (contracts/bot.md, The setup check): per feature what the bot needs in the event's
guild (a channel for each purpose, permissions in it, the privileged intents, the role order),
whether it has it, and a whole sentence to fix it; the fixes the bot can make itself it makes."""

from __future__ import annotations

from typing import Any

from canccu_kit.testing.discord import Intents
from conftest import SHARED_ID, Env
from test_purposes import EVERYDAY, MANAGER, create, put, server

from canccu_bot.perms import PIN_MESSAGES, VIEW_CHANNEL

ON = {"bot.presence": True, "bot.members": True, "pizza.enabled": True}


async def run(env: Env, method: str = "POST") -> dict[str, Any]:
    async with env.client() as c:
        r = await c.request(method, "/api/bot/guild/check", headers=env.reader())
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def feature(body: dict[str, Any], name: str) -> dict[str, Any]:
    found: list[dict[str, Any]] = [f for f in body["features"] if f["feature"] == name]
    return found[0]


async def test_a_server_set_up_by_create_missing_checks_clean(env: Env) -> None:
    await server(env)
    env.contexts["ev-a"]["flags"] = ON
    await create(env)
    body = await run(env)
    assert body["gaps"] == 0
    assert body["checked_at"] == "2026-11-27T10:00:00Z"
    assert {f["feature"]: f["state"] for f in body["features"]} == {
        "announcements": "ok",
        "now_and_next": "ok",
        "food": "ok",
        "photos": "not_on",
        "crew": "ok",
        "tournaments": "not_on",
        "presence": "ok",
        "roles": "ok",
    }
    [row] = feature(body, "food")["rows"]
    assert (row["need"], row["where"]["type"], row["where"]["name"], row["ok"]) == (
        "permission",
        "channel",
        "food",
        True,
    )
    assert {r["need"] for r in feature(body, "roles")["rows"]} == {"intent", "role_order"}
    assert feature(body, "photos")["rows"] == []


async def test_a_permission_the_channel_takes_away_is_fixed_by_the_bot(env: Env) -> None:
    guild = await server(env)
    env.contexts["ev-a"]["flags"] = ON
    bot_role = guild.bot_roles[SHARED_ID][0]
    no_pin = [{"id": bot_role, "type": 0, "allow": "0", "deny": str(PIN_MESSAGES)}]
    food = env.discord.add_channel(guild.id, "food", overwrites=no_pin)
    await put(env, "food", food)
    [row] = feature(await run(env), "food")["rows"]
    assert (row["ok"], row["missing"], row["fix_action"]) == (
        False,
        ["Pin messages"],
        "allow_in_channel",
    )
    assert row["fix"] == "Give the bot “Pin messages” in #food."
    async with env.client() as c:
        r = await c.post("/api/bot/guild/check/fix", json={"feature": "food"}, headers=env.admin())
    assert r.status_code == 200
    assert feature(r.json(), "food")["state"] == "ok"
    bot_user = env.discord.applications[SHARED_ID].bot_user_id
    mine = [o for o in guild.channels[food]["permission_overwrites"] if o["id"] == bot_user]
    assert int(mine[0]["allow"]) & PIN_MESSAGES
    assert env.audit.entries[-1]["action"] == "bot.check.fixed"


async def test_a_permission_the_bots_role_lacks_is_a_fix_in_words_only(env: Env) -> None:
    guild = await server(env, MANAGER & ~PIN_MESSAGES)
    env.contexts["ev-a"]["flags"] = ON
    await put(env, "food", env.discord.add_channel(guild.id, "food"))
    [row] = feature(await run(env), "food")["rows"]
    assert row["fix_action"] is None
    assert row["fix"] == "Give the bot's role “Pin messages” in Server settings → Roles."


async def test_a_missing_channel_points_to_create_missing(env: Env) -> None:
    await server(env)
    [row] = feature(await run(env), "announcements")["rows"]
    assert (row["need"], row["ok"], row["fix_action"]) == ("purpose", False, "create_missing")
    assert "Create what is missing" in row["fix"]


async def test_without_manage_channels_create_missing_is_not_offered(env: Env) -> None:
    await server(env, EVERYDAY)
    [row] = feature(await run(env), "announcements")["rows"]
    assert row["fix_action"] is None
    assert "Manage channels" in row["fix"]


async def test_an_intent_the_application_lacks_is_named(env: Env) -> None:
    await server(env)
    env.contexts["ev-a"]["flags"] = ON
    env.discord.applications[SHARED_ID].privileged = Intents.NONE
    body = await run(env)
    [row] = feature(body, "presence")["rows"]
    assert (row["need"], row["ok"], row["where"]["name"]) == ("intent", False, "Presence intent")
    assert "platform" in row["fix"]  # the shared bot: its operator turns it on


async def test_a_bound_role_above_the_bots_role_is_a_role_order_gap(env: Env) -> None:
    guild = await server(env)
    env.contexts["ev-a"]["flags"] = ON
    above = env.discord.add_role(guild.id, "Attendee")
    await put(env, "attendee_role", above)
    rows = feature(await run(env), "roles")["rows"]
    [gap] = [r for r in rows if r["need"] == "role_order"]
    assert (gap["ok"], gap["where"]["name"]) == (False, "Attendee")
    assert gap["fix"] == "Move the bot's role above Attendee in Server settings → Roles."


async def test_the_last_check_is_shown_until_it_runs_again(env: Env) -> None:
    guild = await server(env)
    channel = env.discord.add_channel(guild.id, "news")
    await put(env, "announcements", channel)
    first = await run(env, "GET")
    assert feature(first, "announcements")["state"] == "ok"
    del guild.channels[channel]
    assert await run(env, "GET") == first
    assert feature(await run(env), "announcements")["state"] == "gaps"


async def test_fixing_needs_the_event_admin_role_and_a_known_feature(env: Env) -> None:
    await server(env)
    async with env.client() as c:
        r = await c.post("/api/bot/guild/check/fix", json={"feature": "food"}, headers=env.reader())
        assert r.status_code == 403
        r = await c.post("/api/bot/guild/check/fix", json={"feature": "x"}, headers=env.admin())
        assert (r.status_code, r.json()["error"]["code"]) == (400, "invalid_request")


async def test_a_channel_the_bot_cannot_view_is_a_fix_in_words_and_a_refused_fix_is_502(
    env: Env,
) -> None:
    guild = await server(env)
    env.contexts["ev-a"]["flags"] = ON
    hidden = [{"id": guild.id, "type": 0, "allow": "0", "deny": str(VIEW_CHANNEL)}]
    crew = env.discord.add_channel(guild.id, "crew", overwrites=hidden)
    await put(env, "food", crew)
    [row] = feature(await run(env), "food")["rows"]
    assert row["ok"] is False
    assert row["fix_action"] is None
    async with env.client() as c:
        r = await c.post("/api/bot/guild/check/fix", json={"feature": "food"}, headers=env.admin())
    assert r.status_code == 200  # nothing was offered, so nothing was tried
    assert "bot.check.fixed" not in [e["action"] for e in env.audit.entries]


async def test_a_refused_overwrite_is_502_and_not_audited(env: Env) -> None:
    guild = await server(env)
    env.contexts["ev-a"]["flags"] = ON
    bot_role = guild.bot_roles[SHARED_ID][0]
    no_pin = [{"id": bot_role, "type": 0, "allow": "0", "deny": str(PIN_MESSAGES)}]
    await put(env, "food", env.discord.add_channel(guild.id, "food", overwrites=no_pin))
    env.discord.fail_next(403, method="PUT")
    async with env.client() as c:
        r = await c.post("/api/bot/guild/check/fix", json={"feature": "food"}, headers=env.admin())
    assert r.status_code == 502
    assert "bot.check.fixed" not in [e["action"] for e in env.audit.entries]


async def test_the_check_is_503_when_the_bots_member_or_application_cannot_be_read(
    env: Env,
) -> None:
    guild = await server(env)
    env.contexts["ev-a"]["flags"] = ON
    bot_user = env.discord.applications[SHARED_ID].bot_user_id
    for path in (f"/guilds/{guild.id}/members/{bot_user}", "/applications/@me"):
        env.discord.fail_next(429, path=path)
        async with env.client() as c:
            r = await c.post("/api/bot/guild/check", headers=env.reader())
        assert r.status_code == 503, path
        assert await env.keys.get(f"bot:check:ev-a:{guild.id}") is None
