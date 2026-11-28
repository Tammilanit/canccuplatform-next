"""The check (contracts/bot.md, The setup check): for every feature that is on, what the bot needs
in the event's guild, whether it has it, and one whole sentence to fix it. A row the bot can fix
itself names its `fix_action`. The last result is kept in Valkey per event and guild, so the page
shows it without asking Discord again until someone runs the check."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from canccu_kit import KitError
from canccu_kit.access import TenantContext
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import server as live
from .access import deps, event_admin
from .client import iso
from .deps import Deps
from .guild import audit
from .perms import MANAGE_CHANNELS, MANAGE_ROLES, names
from .purposes import BY_NAME, Purpose, exists, reader, stored

KEPT_MS = 7 * 24 * 3600 * 1000
# Discord's application flags: a privileged intent turned on in the portal, in full or, for an
# application in fewer than 100 servers, limited; either lets the gateway deliver it.
PRESENCE = ("Presence intent", "Presence Intent", (1 << 12) | (1 << 13))
MEMBERS = ("Server members intent", "Server Members Intent", (1 << 14) | (1 << 15))


@dataclass(frozen=True)
class Feature:
    name: str
    flag: str | None
    purposes: tuple[str, ...] = ()
    intent: tuple[str, str, int] | None = None
    role_order: tuple[str, ...] = ()


FEATURES = (
    Feature("announcements", None, ("announcements",)),
    Feature("now_and_next", None, ("now_and_next",)),
    Feature("food", "pizza.enabled", ("food",)),
    Feature("photos", "screen.photos", ("photos",)),
    Feature("crew", None, ("crew",)),
    Feature("tournaments", "tournament.enabled", ("tournaments", "match_voice")),
    Feature("presence", "bot.presence", intent=PRESENCE),
    # Rights from Discord roles follow the members feed (B8); the bot manages only roles below
    # its own (E6).
    Feature("roles", "bot.members", intent=MEMBERS, role_order=("crew_role", "attendee_role")),
)
BY_FEATURE = {f.name: f for f in FEATURES}


def key(tenant: str, guild_id: str) -> str:
    return f"bot:check:{tenant}:{guild_id}"


def _row(need: str, where: dict[str, Any], ok: bool, fix: str | None = None, **more: Any) -> Any:
    row = {"need": need, "where": where, "ok": ok, "missing": [], "fix": None, "fix_action": None}
    return {**row, "fix": None if ok else fix, **more}


LABELS = {
    "announcements": "Announcements",
    "now_and_next": "Now and next",
    "food": "Food",
    "photos": "Photos",
    "crew": "Crew",
    "tournaments": "Tournaments",
    "match_voice": "Match voice",
}


def _missing_target(purpose: Purpose, server: live.Server, target: str | None) -> Any:
    needed = MANAGE_ROLES if purpose.kind == "role" else MANAGE_CHANNELS
    can = bool(server.base() & needed)
    if purpose.kind == "role":
        fix = f"No {purpose.template_name} role is picked: pick one on Channels"
    else:
        fix = f"{LABELS[purpose.name]} has no {purpose.kind}: pick one on Channels"
    if can:
        fix += ", or use “Create what is missing”."
    else:
        fix += f", or give the bot's role “{names(needed)[0]}” to create it."
    where = {"type": purpose.kind, "id": target, "name": None}
    return _row("purpose", where, False, fix, fix_action="create_missing" if can else None)


def self_fixable(purpose: Purpose, server: live.Server, target: str) -> int:
    """What the bot lacks in the channel and may allow itself there: only what its role holds on
    the server (Discord refuses an overwrite granting more), and only with Manage roles."""
    lacking = purpose.needs & ~server.in_channel(target)
    base = server.base()
    return lacking if lacking and not lacking & ~base and base & MANAGE_ROLES else 0


def _in_channel(purpose: Purpose, server: live.Server, target: str) -> Any:
    channel = server.channels[target]
    shown = ("#" if purpose.kind == "channel" else "") + str(channel.get("name"))
    lacking = purpose.needs & ~server.in_channel(target)
    where = {"type": purpose.kind, "id": target, "name": channel.get("name")}
    row = _row("permission", where, not lacking, missing=names(lacking))
    if lacking:
        words = " and ".join(f"“{n}”" for n in names(lacking))
        if self_fixable(purpose, server, target):
            row["fix"] = f"Give the bot {words} in {shown}."
            row["fix_action"] = "allow_in_channel"
        elif lacking & ~server.base():
            row["fix"] = f"Give the bot's role {words} in Server settings → Roles."
        else:
            row["fix"] = f"Give the bot's role {words} in {shown}'s permissions."
    return row


def _intent(server: live.Server, flags: int, intent: tuple[str, str, int], shared: bool) -> Any:
    name, portal, bits = intent
    where = {"type": "application", "id": server.application_id, "name": name}
    if shared:
        fix = f"The platform's bot has no {name}. Ask the platform's operator to turn it on."
    else:
        fix = f"Turn on {portal} under Bot in the Discord Developer Portal."
    return _row("intent", where, bool(flags & bits), fix)


def _role_order(server: live.Server, target: str) -> Any:
    role = server.roles[target]
    where = {"type": "role", "id": target, "name": role.get("name")}
    ok = int(role.get("position") or 0) < server.top()
    fix = f"Move the bot's role above {role.get('name')} in Server settings → Roles."
    return _row("role_order", where, ok, fix)


async def compute(d: Deps, ctx: TenantContext, server: live.Server) -> dict[str, Any]:
    bound = await stored(d, ctx["tenant_id"])
    app = await server.call(d, "GET", "/applications/@me")
    flags = int((app or {}).get("flags") or 0)
    shared = d.shared is not None and server.application_id == d.shared.application_id
    features: list[dict[str, Any]] = []
    for feature in FEATURES:
        rows: list[Any] = []
        on = feature.flag is None or ctx["flags"].get(feature.flag) is True
        if on:
            for name in (*feature.purposes, *feature.role_order):
                purpose, target = BY_NAME[name], bound.get(name)
                if not exists(purpose, server, target) or target is None:
                    rows.append(_missing_target(purpose, server, target))
                elif purpose.kind == "role":
                    rows.append(_role_order(server, target))
                else:
                    rows.append(_in_channel(purpose, server, target))
            if feature.intent is not None:
                rows.append(_intent(server, flags, feature.intent, shared))
        state = "not_on" if not on else ("ok" if all(r["ok"] for r in rows) else "gaps")
        features.append(
            {"feature": feature.name, "flag": feature.flag, "state": state, "rows": rows}
        )
    gaps = sum(1 for f in features for r in f["rows"] if not r["ok"])
    return {"checked_at": iso(d.now()), "gaps": gaps, "features": features}


async def run(d: Deps, ctx: TenantContext, server: live.Server) -> dict[str, Any]:
    result = await compute(d, ctx, server)
    await d.keys.put(key(ctx["tenant_id"], server.guild_id), json.dumps(result), KEPT_MS)
    return result


async def get_check(request: Request) -> Response:
    d = deps(request)
    ctx = await reader(request)
    server = await live.read(d, ctx)
    kept = await d.keys.get(key(ctx["tenant_id"], server.guild_id))
    return JSONResponse(json.loads(kept) if kept else await run(d, ctx, server))


async def post_check(request: Request) -> Response:
    d = deps(request)
    ctx = await reader(request)
    return JSONResponse(await run(d, ctx, await live.read(d, ctx)))


async def post_fix(request: Request) -> Response:
    """The feature's `allow_in_channel` rows: the bot allows itself, in its own overwrite in that
    channel, what the channel took from its role. A member overwrite outranks the role's."""
    d = deps(request)
    ctx, session = await event_admin(request)
    try:
        body = await request.json()
    except ValueError:
        body = None
    name = body.get("feature") if isinstance(body, dict) and set(body) == {"feature"} else None
    if not isinstance(name, str) or name not in BY_FEATURE:
        raise KitError("feature: one of the check's features", status=400, code="invalid_request")
    server = await live.read(d, ctx)
    bound = await stored(d, ctx["tenant_id"])
    fixed = []
    for purpose in (BY_NAME[p] for p in BY_FEATURE[name].purposes):
        channel = bound.get(purpose.name)
        if channel is None or not exists(purpose, server, channel):
            continue
        missing = self_fixable(purpose, server, channel)
        if not missing:
            continue
        overwrites = server.channels[channel].get("permission_overwrites") or []
        mine: dict[str, Any] = next(
            (o for o in overwrites if o.get("id") == server.bot_user_id), {}
        )
        allow = int(mine.get("allow") or 0) | missing
        deny = int(mine.get("deny") or 0) & ~missing
        path = f"/channels/{channel}/permissions/{server.bot_user_id}"
        body = {"type": 1, "allow": str(allow), "deny": str(deny)}
        if await server.call(d, "PUT", path, body) is not None:
            fixed.append(channel)
    if fixed:
        changes = {"feature": name, "channels": fixed}
        await audit(d, ctx["tenant_id"], session.user_id, "bot.check.fixed", changes, "guild")
    return JSONResponse(await run(d, ctx, await live.read(d, ctx)))


ROUTES = [
    Route("/api/bot/guild/check", get_check, methods=["GET"]),
    Route("/api/bot/guild/check", post_check, methods=["POST"]),
    Route("/api/bot/guild/check/fix", post_fix, methods=["POST"]),
]
