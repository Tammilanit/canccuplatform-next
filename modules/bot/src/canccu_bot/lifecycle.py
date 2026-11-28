"""What the bot does on the tenants module's events (contracts/bot.md, Archived events; Deleted
events and users; Slash commands per guild). Events come at least once and to every container,
so each handler is idempotent: a second run finds nothing left to do. Until #150 emits the
deletion events they are handled as delivered (docs/plans/issue-121.md, B11)."""

from __future__ import annotations

import logging

from canccu_kit import Event, is_tenant_id

from . import commands, store
from .deps import Deps
from .guild import leave
from .look import set_nickname
from .router import Directory

log = logging.getLogger("canccu_bot.lifecycle")


async def tenant_deleted(d: Deps, tenant: str) -> None:
    """The event's connection, binding, routes and secrets go, and nothing is emitted: the
    event's streams go with it. Its own client closes on the pool's next tick, its route gone;
    the shared bot leaves the guild."""
    async with d.db.tenant(tenant) as conn:
        bound = await conn.fetchrow("SELECT guild_id, application_id FROM bot_bindings")
        token = None
        if bound is not None:
            app_id = bound["application_id"]
            token = await store.bot_token(d.shared, d.secrets, conn, tenant, app_id)
        for table in (
            "bot_bindings",
            "bot_purposes",
            "bot_connections",
            "bot_provider_secrets",
            "bot_outbox",
        ):
            await conn.execute(f"DELETE FROM {table}")
        for table in ("bot_guild_routes", "bot_application_routes", "bot_outbox_tenants"):
            await conn.execute(f"DELETE FROM {table} WHERE tenant_id = $1", tenant)
    if bound is not None and token is not None:
        await leave(d, token, bound["application_id"], bound["guild_id"])


async def user_deleted(d: Deps, user_id: str) -> None:
    """The user leaves `bound_by` and `updated_by` in every event. Only an own connection or a
    binding names a user, and each of those has a route, so the routes list every such event."""
    async with d.db.platform() as conn:
        rows = await conn.fetch(
            "SELECT tenant_id FROM bot_guild_routes UNION SELECT tenant_id FROM"
            " bot_application_routes"
        )
    for row in rows:
        async with d.db.tenant(row["tenant_id"]) as conn:
            await conn.execute(
                "UPDATE bot_bindings SET bound_by = NULL WHERE bound_by = $1", user_id
            )
            await conn.execute(
                "UPDATE bot_connections SET updated_by = NULL WHERE updated_by = $1", user_id
            )


async def on_platform(d: Deps, event: Event) -> None:
    """The tenants module's platform events: a deleted event or user."""
    value = event.data.get("tenant_id") or event.data.get("user_id")
    if not isinstance(value, str):
        return
    if event.type == "tenants.tenant.deleted" and is_tenant_id(value):
        await tenant_deleted(d, value)
    elif event.type == "tenants.user.deleted":
        await user_deleted(d, value)


async def on_tenant(d: Deps, directory: Directory, event: Event) -> None:
    """An event's own tenants events: a status or flags change reaches the routers at once, and
    the guild's commands follow (an archived event's are removed); a new name renames the bot."""
    tenant = event.tenant
    if tenant is not None and event.type == "tenants.tenant.changed":
        await renamed(d, tenant, event)
        return
    if tenant is None or event.type not in ("tenants.status.changed", "tenants.flags.changed"):
        return
    directory.forget(tenant)
    if event.type == "tenants.status.changed" and event.data.get("to") != "archived":
        return
    ctx = await d.tenants.by_id(tenant)
    if ctx is not None:
        await commands.register(d, ctx)


async def renamed(d: Deps, tenant: str, event: Event) -> None:
    if d.look is None:
        return
    d.look.forget(tenant)
    changed = event.data.get("changed")
    if not isinstance(changed, list) or "name" not in changed:
        return
    ctx = await d.tenants.by_id(tenant)
    if ctx is not None:
        await set_nickname(d, ctx)
