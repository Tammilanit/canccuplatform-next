"""The tenants module's events (contracts/bot.md, Archived events; Deleted events and users):
a deleted event leaves nothing behind, a deleted user leaves no name, an archived event's
commands are removed and a flags change re-registers them."""

from __future__ import annotations

from canccu_kit import Event
from canccu_kit.testing import tenant_event
from conftest import SHARED_ID, Env
from fakes import MemoryLive
from test_guild import bound

from canccu_bot.guild import unbind
from canccu_bot.lifecycle import on_platform, on_tenant
from canccu_bot.live import live_key
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
    await on_platform(env.deps, platform_event("tenants.tenant.deleted", tenant_id="ev-a"))
    await on_platform(env.deps, platform_event("tenants.tenant.deleted", tenant_id="ev-b"))
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


async def live_state(env: Env, tenant: str = "ev-a") -> MemoryLive:
    live = MemoryLive()
    env.deps.live = live
    for part in ("presence", "voice", "members", "bots", "guild", "channels"):
        await live.hset(live_key(tenant, part), "1", "x")
    return live


async def counts(env: Env, tenant: str = "ev-a") -> None:
    await env.sql(tenant, "INSERT INTO bot_counts_minute (minute, online) VALUES (now(), 3)")
    await env.sql(
        tenant, "INSERT INTO bot_counts_hour (hour, minutes, online) VALUES (now(), 60, 3)"
    )
    await env.sql(
        tenant,
        "INSERT INTO bot_activity_hour (hour, activity_key, name, player_minutes)"
        " VALUES (now(), 'app:77', 'Racing League', 9)",
    )


async def test_archiving_drops_the_live_state_and_keeps_the_counts(env: Env) -> None:
    """Retention (contracts/bot.md, Counts): presence goes, anonymous counts stay."""
    await bound(env)
    live = await live_state(env)
    await counts(env)
    env.contexts["ev-a"]["status"] = "archived"
    event = tenant_event("ev-a", "tenants.status.changed", {"from": "live", "to": "archived"})
    await on_tenant(env.deps, Directory(env.deps), event)
    assert live.values == {}
    for table in ("bot_counts_minute", "bot_counts_hour", "bot_activity_hour"):
        assert len(await env.fetch("ev-a", f"SELECT 1 FROM {table}")) == 1


async def test_a_deleted_event_leaves_no_count_and_no_live_state(env: Env) -> None:
    live = await live_state(env)
    await counts(env)
    await on_platform(env.deps, platform_event("tenants.tenant.deleted", tenant_id="ev-a"))
    assert live.values == {}
    for table in ("bot_counts_minute", "bot_counts_hour", "bot_activity_hour"):
        assert await env.fetch("ev-a", f"SELECT 1 FROM {table}") == []


async def test_a_feed_switched_off_drops_its_live_part_at_once(env: Env) -> None:
    await bound(env)
    live = await live_state(env)
    env.contexts["ev-a"]["flags"] = {"bot.presence": False, "bot.members": True, "bot.voice": True}
    await on_tenant(env.deps, Directory(env.deps), tenant_event("ev-a", "tenants.flags.changed"))
    assert live_key("ev-a", "presence") not in live.values
    assert live_key("ev-a", "voice") in live.values


async def test_an_unbind_drops_the_live_state_of_the_guild(env: Env) -> None:
    await bound(env)
    live = await live_state(env)
    assert await unbind(env.deps, "ev-a", "bot_removed", None)
    assert live.values == {}
