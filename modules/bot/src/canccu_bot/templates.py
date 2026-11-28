"""Create what is missing (contracts/bot.md, Purposes): every purpose that is on and has no
channel or role gets one from its template, the roles first so the crew channel can let the crew
role in. Discord lets the bot manage only roles below its own, so while a bound role sits at or
above the bot's role no role is made, only channels, and the check names the fix (E6)."""

from __future__ import annotations

from typing import Any

from canccu_kit.access import TenantContext
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import server as live
from .access import deps, event_admin
from .deps import Deps
from .perms import MANAGE_CHANNELS, MANAGE_ROLES, VIEW_CHANNEL
from .purposes import BY_NAME, CATALOGUE, TYPES, Purpose, exists, is_on, save, stored, views

ORDER = {p.name: i for i, p in enumerate(CATALOGUE)}


def role_order_ok(server: live.Server, bound: dict[str, str]) -> bool:
    """The bot's role is above every bound role (E6)."""
    top = server.top()
    for purpose in CATALOGUE:
        target = bound.get(purpose.name)
        if purpose.kind == "role" and exists(purpose, server, target) and target is not None:
            if int(server.roles[target].get("position") or 0) >= top:
                return False
    return True


def overwrites(purpose: Purpose, server: live.Server, crew_role: str | None) -> list[Any]:
    """The template's overwrites. Discord refuses an overwrite that allows or denies a
    permission the bot itself lacks on the server, so each is cut to what it holds."""
    held = server.base()
    out: list[dict[str, Any]] = []
    deny = purpose.everyone_deny & held
    if deny:
        out.append({"id": server.guild_id, "type": 0, "allow": "0", "deny": str(deny)})
    if purpose.crew_only and crew_role is not None and held & VIEW_CHANNEL:
        out.append({"id": crew_role, "type": 0, "allow": str(VIEW_CHANNEL), "deny": "0"})
    if purpose.needs & held:
        out.append(
            {"id": server.bot_user_id, "type": 1, "allow": str(purpose.needs & held), "deny": "0"}
        )
    return out


async def _make(
    d: Deps, server: live.Server, purpose: Purpose, crew_role: str | None
) -> str | None:
    guild = f"/guilds/{server.guild_id}"
    if purpose.kind == "role":
        body = {"name": purpose.template_name, "permissions": "0", "mentionable": False}
        made = await server.call(d, "POST", f"{guild}/roles", body)
        if made is not None:
            server.roles[str(made["id"])] = made
    else:
        body = {
            "name": purpose.template_name,
            "type": TYPES[purpose.kind][0],
            "permission_overwrites": overwrites(purpose, server, crew_role),
        }
        made = await server.call(d, "POST", f"{guild}/channels", body)
        if made is not None:
            server.channels[str(made["id"])] = made
    return None if made is None else str(made["id"])


async def create_missing(
    d: Deps, ctx: TenantContext, server: live.Server, bound: dict[str, str]
) -> tuple[dict[str, str], list[dict[str, str]]]:
    missing = [p for p in CATALOGUE if is_on(p, ctx) and not exists(p, server, bound.get(p.name))]
    held = server.base()
    roles_ok = role_order_ok(server, bound)
    created: dict[str, str] = {}
    skipped: list[dict[str, str]] = []
    # Roles first: the crew channel lets the crew role in.
    for purpose in sorted(missing, key=lambda p: p.kind != "role"):
        reason = None
        if purpose.kind == "role" and not held & MANAGE_ROLES:
            reason = "missing_permission"
        elif purpose.kind == "role" and not roles_ok:
            reason = "role_order"
        elif purpose.kind != "role" and not held & MANAGE_CHANNELS:
            reason = "missing_permission"
        if reason is None:
            crew = created.get("crew_role") or bound.get("crew_role")
            crew = crew if exists(BY_NAME["crew_role"], server, crew) else None
            made = await _make(d, server, purpose, crew)
            if made is not None:
                created[purpose.name] = made
                continue
            reason = "discord_refused"
        skipped.append({"purpose": purpose.name, "reason": reason})
    skipped.sort(key=lambda s: ORDER[s["purpose"]])
    return dict(sorted(created.items(), key=lambda c: ORDER[c[0]])), skipped


async def post_create_missing(request: Request) -> Response:
    d = deps(request)
    ctx, session = await event_admin(request)
    server = await live.read(d, ctx)
    bound = await stored(d, ctx["tenant_id"])
    created, skipped = await create_missing(d, ctx, server, bound)
    if created:
        changes: dict[str, str | None] = dict(created)
        await save(d, ctx["tenant_id"], changes, session.user_id, "bot.purposes.created")
    body = {
        "created": list(created),
        "skipped": skipped,
        "purposes": views(ctx, server, {**bound, **created}),
    }
    return JSONResponse(body)


ROUTES = [Route("/api/bot/guild/purposes/create-missing", post_create_missing, methods=["POST"])]
