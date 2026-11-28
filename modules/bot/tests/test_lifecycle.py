"""The tenants module's events (contracts/bot.md, Archived events; Deleted events and users):
a deleted event leaves nothing behind, a deleted user leaves no name, an archived event's
commands are removed and a flags change re-registers them."""

from __future__ import annotations

from canccu_kit import Event
from canccu_kit.testing import tenant_event
from conftest import SHARED_ID, Env
from test_guild import bound

from canccu_bot.lifecycle import on_platform, on_tenant
from canccu_bot.router import Directory


def platform_event(type: str, **data: str) -> Event:
    return Event("e1", type, 1, "2026-11-27T10:00:00Z", "tenants", dict(data))


async def own(env: Env, tenant: str) -> str:
    app = env.discord.add_application("Own Bot")
    token = env.deps.secrets.seal(app.token, f"bot:token:{tenant}:{app.id}")
    await env.sql(
        tenant,
        "INSERT INTO bot_connections (mode, application_id, bot_token, updated_by, revision)"
        " VALUES ('own', $1, $2, 'u_gone', 1)",
        app.id,
        token,
    )
    await env.platform_sql("INSERT INTO bot_application_routes VALUES ($1, $2)", app.id, tenant)
    return app.id


async def test_a_deleted_event_leaves_no_row_route_or_secret(env: Env) -> None:
    guild = await bound(env, "ev-a")
    await own(env, "ev-b")
    await bound(
        env,
        "ev-b",
        app_id=(await env.fetch(None, "SELECT application_id FROM bot_application_routes"))[0][0],
    )
    await env.sql(
        "ev-a",
        "INSERT INTO bot_purposes (purpose, target_id, updated_at)"
        " VALUES ('crew', '100000000000000777', now())",
    )
    # How an earlier binding ended, which the Discord page shows, goes with the event too.
    await env.keys.put("bot:ended:ev-a", '{"reason": "bot_removed"}', 60_000)
    await on_platform(env.deps, platform_event("tenants.tenant.deleted", tenant_id="ev-a"))
    await on_platform(env.deps, platform_event("tenants.tenant.deleted", tenant_id="ev-b"))
    assert await env.keys.get("bot:ended:ev-a") is None
    for tenant in ("ev-a", "ev-b"):
        assert await env.fetch(tenant, "SELECT 1 FROM bot_bindings") == []
        assert await env.fetch(tenant, "SELECT 1 FROM bot_connections") == []
        assert await env.fetch(tenant, "SELECT 1 FROM bot_purposes") == []
        assert env.events(tenant) == []
    assert await env.fetch(None, "SELECT 1 FROM bot_guild_routes") == []
    assert await env.fetch(None, "SELECT 1 FROM bot_application_routes") == []
    assert SHARED_ID not in guild.bots  # the shared bot left the deleted event's guild


async def test_a_deleted_user_is_dropped_from_bound_by_and_updated_by(env: Env) -> None:
    app_id = await own(env, "ev-a")
    await bound(env, "ev-b")
    await env.sql("ev-b", "UPDATE bot_bindings SET bound_by = 'u_gone'")
    await on_platform(env.deps, platform_event("tenants.user.deleted", user_id="u_gone"))
    [row] = await env.fetch("ev-a", "SELECT updated_by, application_id FROM bot_connections")
    assert tuple(row) == (None, app_id)
    [row] = await env.fetch("ev-b", "SELECT bound_by FROM bot_bindings")
    assert row["bound_by"] is None


async def test_an_archived_event_keeps_its_binding_but_loses_its_commands(env: Env) -> None:
    guild = await bound(env)
    env.contexts["ev-a"]["status"] = "archived"
    event = tenant_event("ev-a", "tenants.status.changed", {"from": "live", "to": "archived"})
    await on_tenant(env.deps, Directory(env.deps), event)
    assert guild.commands[SHARED_ID] == []
    [row] = await env.fetch("ev-a", "SELECT commands_status FROM bot_bindings")
    assert row["commands_status"] == "removed"


async def test_a_flags_change_registers_the_commands_again(env: Env) -> None:
    guild = await bound(env)
    env.contexts["ev-a"]["flags_version"] = 4
    await on_tenant(env.deps, Directory(env.deps), tenant_event("ev-a", "tenants.flags.changed"))
    assert guild.commands[SHARED_ID] == []
    [row] = await env.fetch(
        "ev-a", "SELECT commands_status, commands_flags_version FROM bot_bindings"
    )
    assert tuple(row) == ("registered", 4)
