"""Ending a binding (contracts/bot.md, Binding a guild): by the event admin, by the superadmin,
by the guild removing the bot, and with a deleted event; and re-registering the guild's commands.

One path ends them all: the binding and its route go in one transaction with the event, then the
event's commands are removed from the guild and the shared bot leaves it. An own bot stays (the
guild is the event's own application's) but serves the guild no more."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from canccu_kit import KitError, tenant_scope
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import commands, store
from .access import deps, event_admin
from .connection import binding_view
from .deps import Deps
from .discord_api import DiscordRefused

log = logging.getLogger("canccu_bot.guild")

SNOWFLAKE = re.compile(r"^[0-9]{17,20}$")
_tasks: set[asyncio.Task[None]] = set()


ENDED_TTL_MS = 30 * 24 * 3600 * 1000


def ended_key(tenant: str) -> str:
    """How the event's last binding ended, for the Discord page: a server that removed the bot
    unbinds itself (`bot_removed`), and the page says so in words rather than just "not
    connected" (mockup 15). No row keeps it: the binding is gone."""
    return f"bot:ended:{tenant}"


def not_found(what: str = "no guild is bound") -> KitError:
    return KitError(what, status=404, code="not_found")


async def unbind(
    d: Deps, tenant: str, reason: str, actor: str | None, *, why: str | None = None
) -> bool:
    """End the event's binding; False when it has none. `bot_removed` touches nothing on Discord:
    the bot is already out."""
    with tenant_scope(tenant):
        async with d.db.tenant(tenant) as conn:
            bound = await conn.fetchrow(
                "SELECT guild_id, guild_name, application_id FROM bot_bindings FOR UPDATE"
            )
            if bound is None:
                return False
            guild, app_id = bound["guild_id"], bound["application_id"]
            token = await store.bot_token(d.shared, d.secrets, conn, tenant, app_id)
            await conn.execute("DELETE FROM bot_bindings")
            await conn.execute("DELETE FROM bot_purposes")  # they name the guild's channels
            await conn.execute("DELETE FROM bot_posts")  # and its messages
            await conn.execute(
                "DELETE FROM bot_guild_routes WHERE guild_id = $1 AND tenant_id = $2",
                guild,
                tenant,
            )
            data = {"guild_id": guild, "reason": reason, "actor_user_id": actor}
            await d.outbox.add(conn, "bot.guild.unbound", data, version=1)
        await d.outbox.flush(tenant)
    note = {"reason": reason, "guild_name": bound["guild_name"], "at": d.now().isoformat()}
    await d.keys.put(ended_key(tenant), json.dumps(note), ENDED_TTL_MS)
    await audit(d, tenant, actor, "bot.guild.unbound", {"reason": reason}, "guild", guild, why)
    if reason != "bot_removed" and token is not None:
        await leave(d, token, app_id, guild)
    return True


async def leave(d: Deps, token: str, app_id: str, guild: str) -> None:
    """The guild loses the event's commands, and the shared bot leaves it. Discord trouble here
    is logged: the binding has ended either way, and a shared bot still in an unbound guild
    leaves it on its own after 15 minutes (router.py)."""
    try:
        await d.discord.as_bot(token, "PUT", f"/applications/{app_id}/guilds/{guild}/commands", [])
        if d.shared is not None and app_id == d.shared.application_id:
            await d.discord.as_bot(token, "DELETE", f"/users/@me/guilds/{guild}")
    except DiscordRefused:
        log.warning("cleaning up guild %s after its unbind failed", guild)


async def audit(
    d: Deps,
    tenant: str,
    actor: str | None,
    action: str,
    changes: dict[str, Any],
    target: str,
    target_id: str | None = None,
    reason: str | None = None,
) -> None:
    """One audit entry after the change committed; `target_id` defaults to the event."""
    entry = {"type": target, "id": target_id or tenant}
    try:
        await d.audit.append(tenant, actor, action, entry, changes, reason)
    except Exception:
        # The change is committed; a missing entry is logged rather than reported as a failure.
        log.exception("could not audit %s of %s", action, tenant)


async def delete_guild(request: Request) -> Response:
    ctx, session = await event_admin(request, writable=False)  # also on an archived event
    if not await unbind(deps(request), ctx["tenant_id"], "unbound", session.user_id):
        raise not_found()
    return Response(status_code=204)


async def superadmin_unbind(request: Request) -> Response:
    d = deps(request)
    d.hosts.require_superadmin_host(request)
    session = await d.rights.require_superadmin(request.headers.get("cookie"))
    guild = request.path_params["guild_id"]
    try:
        body = await request.json()
    except ValueError:
        body = None
    reason = body.get("reason") if isinstance(body, dict) and set(body) == {"reason"} else None
    if not isinstance(reason, str) or not 1 <= len(reason) <= 500:
        raise KitError("reason: 1 to 500 characters", status=400, code="invalid_request")
    if not SNOWFLAKE.fullmatch(guild):
        raise not_found("no such guild binding")
    async with d.db.platform() as conn:
        tenant = await conn.fetchval(
            "SELECT tenant_id FROM bot_guild_routes WHERE guild_id = $1", guild
        )
    if tenant is None or not await unbind(d, tenant, "superadmin", session.user_id, why=reason):
        raise not_found("no such guild binding")
    return Response(status_code=204)


def in_background(job: Any) -> None:
    task = asyncio.create_task(job)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def sync_commands(request: Request) -> Response:
    d = deps(request)
    ctx, _ = await event_admin(request)
    async with d.db.tenant() as conn:
        bound = await conn.fetchrow(
            "UPDATE bot_bindings SET commands_status = 'pending', commands_error_code = NULL"
            " RETURNING *"
        )
    if bound is None:
        raise not_found()
    in_background(commands.register(d, ctx, force=True))
    return JSONResponse(binding_view(bound), status_code=202)


ROUTES = [
    Route("/api/bot/guild", delete_guild, methods=["DELETE"]),
    Route("/api/bot/guild/commands/sync", sync_commands, methods=["POST"]),
    Route("/api/bot/guilds/{guild_id}/unbind", superadmin_unbind, methods=["POST"]),
]
