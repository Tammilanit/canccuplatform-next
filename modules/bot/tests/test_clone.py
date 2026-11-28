"""Clone (contracts/bot.md, Clone): the source's own application and binding move to the new
event in one transaction with their routes, re-sealed for it; the source falls back to shared."""

from __future__ import annotations

from typing import Any

from conftest import SHARED_ID, Env
from test_guild import bound
from test_lifecycle import own


async def clone(env: Env, source: str = "ev-b", host: str = "a.example.test") -> Any:
    async with env.client(host) as c:
        return await c.post(
            "/api/bot/clone", json={"source_tenant_id": source}, headers=env.admin()
        )


async def test_the_connection_and_binding_move_with_their_routes(env: Env) -> None:
    env.series.admin_of = {"ev-a", "ev-b"}
    env.contexts["ev-b"]["status"] = "archived"
    app_id = await own(env, "ev-b")
    guild = await bound(env, "ev-b", app_id=app_id)
    r = await clone(env)
    assert r.status_code == 200
    assert (r.json()["moved_connection"], r.json()["moved_binding"]) == (True, True)
    assert r.json()["connection"]["application_id"] == app_id
    assert r.json()["connection"]["guild"]["guild_id"] == guild.id
    [row] = await env.fetch("ev-a", "SELECT bot_token FROM bot_connections")
    opened = env.deps.secrets.open_text(row["bot_token"], f"bot:token:ev-a:{app_id}")
    assert opened == env.discord.applications[app_id].token
    [src] = await env.fetch("ev-b", "SELECT mode, bot_token FROM bot_connections")
    assert tuple(src) == ("shared", None)
    assert await env.fetch("ev-b", "SELECT 1 FROM bot_bindings") == []
    routes = await env.fetch(
        None,
        "SELECT tenant_id FROM bot_guild_routes"
        " UNION ALL SELECT tenant_id FROM bot_application_routes",
    )
    assert [x["tenant_id"] for x in routes] == ["ev-a", "ev-a"]
    assert [e["type"] for e in env.events("ev-b")] == [
        "bot.connection.changed",
        "bot.guild.unbound",
    ]
    assert env.events("ev-b")[1]["data"]["reason"] == "moved"
    assert [e["type"] for e in env.events("ev-a")] == ["bot.connection.changed", "bot.guild.bound"]
    assert {e["tenant_id"] for e in env.audit.entries} == {"ev-a", "ev-b"}


async def test_nothing_to_move_is_no_error(env: Env) -> None:
    env.series.admin_of = {"ev-a", "ev-b"}
    env.contexts["ev-b"]["status"] = "draft"
    r = await clone(env)
    assert r.status_code == 200
    assert (r.json()["moved_connection"], r.json()["moved_binding"]) == (False, False)


async def test_a_live_source_keeps_its_bot(env: Env) -> None:
    env.series.admin_of = {"ev-a", "ev-b"}
    await bound(env, "ev-b")
    r = await clone(env)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "source_live")


async def test_a_target_with_its_own_guild_is_already_connected(env: Env) -> None:
    env.series.admin_of = {"ev-a", "ev-b"}
    env.contexts["ev-b"]["status"] = "archived"
    await bound(env, "ev-b")
    env.discord.add_guild("x")
    await env.sql(
        "ev-a",
        "INSERT INTO bot_bindings (guild_id, guild_name, application_id)"
        " VALUES ('100000000000000777', 'Mine', $1)",
        SHARED_ID,
    )
    r = await clone(env)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "already_connected")
    assert await env.fetch("ev-b", "SELECT 1 FROM bot_bindings") != []  # rolled back


async def test_a_binding_does_not_move_onto_a_target_with_its_own_application(env: Env) -> None:
    env.series.admin_of = {"ev-a", "ev-b"}
    env.contexts["ev-b"]["status"] = "archived"
    await bound(env, "ev-b")
    await own(env, "ev-a")
    r = await clone(env)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "already_connected")
    assert await env.fetch("ev-b", "SELECT 1 FROM bot_bindings") != []  # rolled back
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_bindings") == []


async def test_an_own_application_does_not_move_onto_a_target_with_a_guild(env: Env) -> None:
    env.series.admin_of = {"ev-a", "ev-b"}
    env.contexts["ev-b"]["status"] = "archived"
    await own(env, "ev-b")
    await bound(env, "ev-a")
    r = await clone(env)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "already_connected")
    [src] = await env.fetch("ev-b", "SELECT mode FROM bot_connections")
    assert src["mode"] == "own"  # rolled back


async def test_without_the_role_on_both_events_it_is_403(env: Env) -> None:
    env.series.admin_of = {"ev-a"}
    env.contexts["ev-b"]["status"] = "archived"
    r = await clone(env)
    assert (r.status_code, r.json()["error"]["code"]) == (403, "missing_right")


async def test_the_purposes_move_with_the_binding(env: Env) -> None:
    env.series.admin_of = {"ev-a", "ev-b"}
    env.contexts["ev-b"]["status"] = "archived"
    await bound(env, "ev-b")
    await env.sql(
        "ev-b",
        "INSERT INTO bot_purposes (purpose, target_id, updated_at)"
        " VALUES ('announcements', '100000000000000777', now())",
    )
    assert (await clone(env)).status_code == 200
    assert await env.fetch("ev-b", "SELECT 1 FROM bot_purposes") == []
    [row] = await env.fetch("ev-a", "SELECT purpose, target_id FROM bot_purposes")
    assert tuple(row) == ("announcements", "100000000000000777")
