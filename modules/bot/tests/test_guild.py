"""Ending a binding (contracts/bot.md, Binding a guild): the event admin's unbind, the
superadmin's on the superadmin hostname only, and the guild's commands synced on request."""

from __future__ import annotations

import asyncio

from canccu_kit.testing.discord import FakeGuild
from conftest import SHARED_ID, SUPERADMIN, Env

from canccu_bot import guild as guild_paths


async def bound(env: Env, tenant: str = "ev-a", app_id: str = SHARED_ID) -> FakeGuild:
    """A guild bound to the event, with the bot in it and a command registered."""
    guild = env.discord.add_guild("Demo Community", bots=[app_id])
    guild.commands[app_id] = [{"name": "old"}]
    await env.sql(
        tenant,
        "INSERT INTO bot_bindings (guild_id, guild_name, application_id, bound_by)"
        " VALUES ($1, 'Demo Community', $2, 'u_org')",
        guild.id,
        app_id,
    )
    await env.platform_sql(
        "INSERT INTO bot_guild_routes VALUES ($1, $2, $3)", guild.id, tenant, app_id
    )
    return guild


async def test_unbind_removes_the_route_the_commands_and_the_shared_bot(env: Env) -> None:
    guild = await bound(env)
    async with env.client() as c:
        r = await c.delete("/api/bot/guild", headers=env.admin())
    assert r.status_code == 204
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_bindings") == []
    assert await env.fetch(None, "SELECT 1 FROM bot_guild_routes") == []
    assert guild.commands[SHARED_ID] == []
    assert SHARED_ID not in guild.bots
    assert env.events("ev-a") == [
        {
            "type": "bot.guild.unbound",
            "data": {"guild_id": guild.id, "reason": "unbound", "actor_user_id": "u_org"},
        }
    ]
    assert env.audit.entries[0]["action"] == "bot.guild.unbound"


async def test_an_own_bot_stays_in_the_guild_but_loses_the_commands(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    token = env.deps.secrets.seal(app.token, f"bot:token:ev-a:{app.id}")
    await env.sql(
        "ev-a",
        "INSERT INTO bot_connections (mode, application_id, bot_token, revision)"
        " VALUES ('own', $1, $2, 1)",
        app.id,
        token,
    )
    guild = await bound(env, app_id=app.id)
    async with env.client() as c:
        assert (await c.delete("/api/bot/guild", headers=env.admin())).status_code == 204
    assert app.id in guild.bots
    assert guild.commands[app.id] == []


async def test_unbind_works_on_an_archived_event_and_404s_without_a_binding(env: Env) -> None:
    env.contexts["ev-a"]["status"] = "archived"
    async with env.client() as c:
        assert (await c.delete("/api/bot/guild", headers=env.admin())).status_code == 404
        await bound(env)
        assert (await c.delete("/api/bot/guild", headers=env.admin())).status_code == 204


async def test_unbind_needs_the_event_admin_role(env: Env) -> None:
    await bound(env)
    async with env.client() as c:
        r = await c.delete("/api/bot/guild", headers=env.reader())
    assert r.status_code == 403


async def test_the_superadmin_unbinds_any_guild_with_a_reason(env: Env) -> None:
    guild = await bound(env, "ev-b")
    headers = env.rights.sign_in("u_super", superadmin=True)
    async with env.client(SUPERADMIN) as c:
        r = await c.post(
            f"/api/bot/guilds/{guild.id}/unbind", json={"reason": "a dispute"}, headers=headers
        )
    assert r.status_code == 204
    assert env.events("ev-b")[0]["data"] == {
        "guild_id": guild.id,
        "reason": "superadmin",
        "actor_user_id": "u_super",
    }
    assert env.audit.entries[0]["reason"] == "a dispute"


async def test_the_superadmin_path_is_404_elsewhere_and_403_for_others(env: Env) -> None:
    guild = await bound(env)
    path = f"/api/bot/guilds/{guild.id}/unbind"
    async with env.client() as c:
        elsewhere = await c.post(
            path, json={"reason": "x"}, headers=env.rights.sign_in("u_s", superadmin=True)
        )
    async with env.client(SUPERADMIN) as c:
        owner = await c.post(path, json={"reason": "x"}, headers=env.admin())
        no_reason = await c.post(path, json={}, headers=env.rights.sign_in("u_s", superadmin=True))
        unknown = await c.post(
            "/api/bot/guilds/100000000000000999/unbind",
            json={"reason": "x"},
            headers=env.rights.sign_in("u_s", superadmin=True),
        )
    assert elsewhere.status_code == 404
    assert (owner.status_code, owner.json()["error"]["code"]) == (403, "missing_right")
    assert no_reason.status_code == 400
    assert unknown.status_code == 404
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_bindings") != []


async def test_event_paths_answer_404_on_a_platform_hostname(env: Env) -> None:
    async with env.client(SUPERADMIN) as c:
        r = await c.get("/api/bot/connection", headers=env.reader())
    assert r.status_code == 404


async def test_sync_registers_the_commands_again_in_the_background(env: Env) -> None:
    guild = await bound(env)
    async with env.client() as c:
        r = await c.post("/api/bot/guild/commands/sync", headers=env.admin())
    assert r.status_code == 202
    assert r.json()["commands"]["status"] == "pending"
    await asyncio.gather(*guild_paths._tasks)
    assert guild.commands[SHARED_ID] == []
    [row] = await env.fetch(
        "ev-a", "SELECT commands_status, commands_flags_version FROM bot_bindings"
    )
    assert tuple(row) == ("registered", 0)


async def test_a_failed_registration_shows_on_the_binding(env: Env) -> None:
    guild = await bound(env)
    env.discord.fail_next(403, path=f"/applications/{SHARED_ID}/guilds/{guild.id}/commands")
    async with env.client() as c:
        await c.post("/api/bot/guild/commands/sync", headers=env.admin())
    await asyncio.gather(*guild_paths._tasks)
    [row] = await env.fetch("ev-a", "SELECT commands_status, commands_error_code FROM bot_bindings")
    assert tuple(row) == ("failed", "missing_access")


async def test_sync_is_404_without_a_binding_and_409_when_archived(env: Env) -> None:
    async with env.client() as c:
        assert (
            await c.post("/api/bot/guild/commands/sync", headers=env.admin())
        ).status_code == 404
        env.contexts["ev-a"]["status"] = "archived"
        r = await c.post("/api/bot/guild/commands/sync", headers=env.admin())
    assert (r.status_code, r.json()["error"]["code"]) == (409, "event_archived")


async def test_a_failing_key_store_neither_skips_the_audit_nor_keeps_the_bot_in(env: Env) -> None:
    guild = await bound(env)

    async def broken(*_: object) -> None:
        raise ConnectionError("valkey is down")

    env.keys.put = broken  # type: ignore[assignment]
    async with env.client() as c:
        assert (await c.delete("/api/bot/guild", headers=env.admin())).status_code == 204
    assert env.audit.entries[0]["action"] == "bot.guild.unbound"
    assert SHARED_ID not in guild.bots
