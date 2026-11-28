"""Purposes (contracts/bot.md, Purposes): what the bot uses a channel or a role of the event's
guild for. A fixed catalogue, each purpose under its feature's flag with a template to create it
from; the event admin picks an existing channel or role, or has the missing ones created. The
pick lists and every state are read live from Discord (server.py)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from canccu_kit import KitError
from canccu_kit.access import TenantContext, check_admin_access, tailscale_cidrs
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import server as live
from .access import client_ip, deps, event_admin, tenant_of
from .connection import READ
from .deps import Deps
from .guild import audit
from .perms import (
    EMBED_LINKS,
    MANAGE_CHANNELS,
    MOVE_MEMBERS,
    PIN_MESSAGES,
    READ_MESSAGE_HISTORY,
    SEND_MESSAGES,
    VIEW_CHANNEL,
)

POST = VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS
SNOWFLAKE = re.compile(r"^[0-9]{17,20}$")
# Discord's channel types a purpose takes: a text or an announcement channel, or a category.
TYPES = {"channel": (0, 5), "category": (4,)}


@dataclass(frozen=True)
class Purpose:
    name: str
    kind: str
    """`channel`, `category` or `role`."""
    flag: str | None
    """The feature flag it serves; None when every event uses it."""
    template_name: str
    needs: int = 0
    """The bot's permissions in the channel (the check's rows, setup_check.py)."""
    everyone_deny: int = 0
    """What the template denies @everyone: the bot's own channels are for its posts."""
    crew_only: bool = False


# The tournament module (step 7) declares `tournament.enabled`; until then no event carries it,
# and a flag the event's context does not carry counts as off (contracts/bot.md).
CATALOGUE = (
    Purpose("announcements", "channel", None, "announcements", POST, SEND_MESSAGES),
    Purpose("now_and_next", "channel", None, "now-and-next", POST | PIN_MESSAGES, SEND_MESSAGES),
    Purpose("food", "channel", "pizza.enabled", "food", POST | PIN_MESSAGES, SEND_MESSAGES),
    Purpose("photos", "channel", "screen.photos", "photos", VIEW_CHANNEL | READ_MESSAGE_HISTORY),
    Purpose("crew", "channel", None, "crew", POST, VIEW_CHANNEL, crew_only=True),
    Purpose("tournaments", "channel", "tournament.enabled", "tournaments", POST, SEND_MESSAGES),
    Purpose(
        "match_voice",
        "category",
        "tournament.enabled",
        "Match voice",
        VIEW_CHANNEL | MANAGE_CHANNELS | MOVE_MEMBERS,
    ),
    Purpose("crew_role", "role", None, "Crew"),
    Purpose("attendee_role", "role", None, "Attendee"),
)
BY_NAME = {p.name: p for p in CATALOGUE}


def is_on(purpose: Purpose, ctx: TenantContext) -> bool:
    return purpose.flag is None or ctx["flags"].get(purpose.flag) is True


def exists(purpose: Purpose, server: live.Server, target: str | None) -> bool:
    if target is None:
        return False
    if purpose.kind == "role":
        role = server.roles.get(target)
        return role is not None and target != server.guild_id and not role.get("managed")
    channel = server.channels.get(target)
    return channel is not None and channel.get("type") in TYPES[purpose.kind]


def view(
    purpose: Purpose, ctx: TenantContext, server: live.Server | None, target: str | None
) -> dict[str, Any]:
    found = server is not None and exists(purpose, server, target)
    if not is_on(purpose, ctx):
        state = "not_on"
    else:
        state = "bound" if found else "missing"
    name = None
    if found and server is not None and target is not None:
        name = (server.roles if purpose.kind == "role" else server.channels)[target].get("name")
    return {
        "purpose": purpose.name,
        "kind": purpose.kind,
        "flag": purpose.flag,
        "state": state,
        "target_id": target,
        "target_name": name,
        "template_name": purpose.template_name,
    }


async def stored(d: Deps, tenant: str) -> dict[str, str]:
    async with d.db.tenant(tenant) as conn:
        rows = await conn.fetch("SELECT purpose, target_id FROM bot_purposes")
    return {r["purpose"]: r["target_id"] for r in rows}


def views(ctx: TenantContext, server: live.Server, bound: dict[str, str]) -> list[dict[str, Any]]:
    return [view(p, ctx, server, bound.get(p.name)) for p in CATALOGUE]


async def save(
    d: Deps, tenant: str, changes: dict[str, str | None], actor: str, action: str
) -> None:
    """The bindings, their event for the posts that follow them (#122) and the audit entry."""
    async with d.db.tenant(tenant) as conn:
        for name, target in changes.items():
            if target is None:
                await conn.execute("DELETE FROM bot_purposes WHERE purpose = $1", name)
            else:
                await conn.execute(
                    "INSERT INTO bot_purposes (purpose, target_id, updated_at) VALUES ($1, $2, $3)"
                    " ON CONFLICT (tenant_id, purpose) DO UPDATE"
                    " SET target_id = $2, updated_at = $3",
                    name,
                    target,
                    d.now(),
                )
        data = {"purposes": changes, "actor_user_id": actor}
        await d.outbox.add(conn, "bot.purposes.changed", data, version=1)
    await d.outbox.flush(tenant)
    await audit(d, tenant, actor, action, {"purposes": changes}, "guild")


async def reader(request: Request) -> TenantContext:
    """A read of the setup: `bot.connection.read`, under the event's admin-access rule."""
    ctx = tenant_of(request)
    await deps(request).rights.check(request.headers.get("cookie"), READ)
    check_admin_access(ctx, client_ip(request), tailscale_cidrs())  # 403 admin_access_restricted
    return ctx


async def get_purposes(request: Request) -> Response:
    d = deps(request)
    ctx = await reader(request)
    server = await live.read(d, ctx)
    return JSONResponse({"purposes": views(ctx, server, await stored(d, ctx["tenant_id"]))})


def invalid(why: str) -> KitError:
    return KitError(why, status=400, code="target_invalid")


async def put_purpose(request: Request) -> Response:
    d = deps(request)
    purpose = BY_NAME.get(request.path_params["purpose"])
    if purpose is None:
        raise KitError("no such purpose", status=404, code="not_found")
    ctx, session = await event_admin(request)
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or set(body) != {"target_id"}:
        raise KitError("an object with target_id only", status=400, code="invalid_request")
    target = body["target_id"]
    server = await live.read(d, ctx)
    if target is not None:
        if not isinstance(target, str) or not SNOWFLAKE.fullmatch(target):
            raise invalid("target_id: a channel or role id of the guild, or null")
        if not exists(purpose, server, target):
            raise invalid(f"not a {purpose.kind} of this guild the bot can use for it")
    await save(d, ctx["tenant_id"], {purpose.name: target}, session.user_id, "bot.purpose.changed")
    return JSONResponse(view(purpose, ctx, server, target))


async def get_channels(request: Request) -> Response:
    server = await live.read(deps(request), await reader(request))
    keys = ("id", "name", "type", "parent_id", "position")
    channels = sorted(server.channels.values(), key=lambda c: (c.get("position") or 0, c["id"]))
    return JSONResponse({"channels": [{k: c.get(k) for k in keys} for c in channels]})


async def get_roles(request: Request) -> Response:
    server = await live.read(deps(request), await reader(request))
    roles = [r for r in server.roles.values() if r["id"] != server.guild_id]
    roles.sort(key=lambda r: (-(r.get("position") or 0), r["id"]))  # top first, as Discord lists
    keys = ("id", "name", "position")
    shown = [{**{k: r.get(k) for k in keys}, "managed": bool(r.get("managed"))} for r in roles]
    return JSONResponse({"roles": shown})


ROUTES = [
    Route("/api/bot/guild/purposes", get_purposes, methods=["GET"]),
    Route("/api/bot/guild/purposes/{purpose}", put_purpose, methods=["PUT"]),
    Route("/api/bot/guild/channels", get_channels, methods=["GET"]),
    Route("/api/bot/guild/roles", get_roles, methods=["GET"]),
]
