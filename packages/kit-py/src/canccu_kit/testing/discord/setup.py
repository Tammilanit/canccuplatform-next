"""The fake's routes for a guild's setup (#764): channels and roles read and created, the bot's own
member, a channel's permission overwrite and the application's intent flags. The fake checks no
permission here: the bot decides from what it reads, and a test scripts a refusal with
`fail_next`."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from starlette.responses import JSONResponse, Response

from .model import FakeApplication, FakeGuild, Intents

if TYPE_CHECKING:
    from .fake import FakeDiscord

# Discord's application flags for privileged intents turned on in the developer portal.
GATEWAY_PRESENCE = 1 << 12
GATEWAY_GUILD_MEMBERS = 1 << 14


def _error(status: int, message: str, code: int) -> JSONResponse:
    return JSONResponse({"message": message, "code": code}, status_code=status)


def _guild(fake: FakeDiscord, app: FakeApplication, guild_id: str) -> FakeGuild | None:
    guild = fake.guilds.get(guild_id)
    return guild if guild is not None and app.id in guild.bots else None


def _missing() -> JSONResponse:
    return _error(403, "Missing Access", 50001)


async def application(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    flags = 0
    if app.privileged & Intents.GUILD_PRESENCES:
        flags |= GATEWAY_PRESENCE
    if app.privileged & Intents.GUILD_MEMBERS:
        flags |= GATEWAY_GUILD_MEMBERS
    return JSONResponse({"id": app.id, "name": app.name, "flags": flags})


async def channels(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    guild = _guild(fake, app, p["guild_id"])
    if guild is None:
        return _missing()
    return JSONResponse(list(guild.channels.values()))


async def create_channel(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    guild = _guild(fake, app, p["guild_id"])
    if guild is None:
        return _missing()
    body = body or {}
    channel_id = fake.add_channel(
        guild.id,
        str(body.get("name") or ""),
        type=int(body.get("type") or 0),
        overwrites=body.get("permission_overwrites"),
        parent_id=body.get("parent_id"),
    )
    return JSONResponse(guild.channels[channel_id], status_code=201)


async def roles(fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any) -> Response:
    guild = _guild(fake, app, p["guild_id"])
    if guild is None:
        return _missing()
    return JSONResponse(list(guild.roles.values()))


async def create_role(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    """A new role sits just above @everyone, as on Discord: every other role moves up one."""
    guild = _guild(fake, app, p["guild_id"])
    if guild is None:
        return _missing()
    for role in guild.roles.values():
        if role["position"] > 0:
            role["position"] += 1
    body = body or {}
    role_id = fake.snowflake()
    guild.roles[role_id] = {
        "id": role_id,
        "name": str(body.get("name") or "new role"),
        "position": 1,
        "permissions": str(body.get("permissions") or "0"),
        "managed": False,
    }
    return JSONResponse(guild.roles[role_id])


async def member(fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any) -> Response:
    guild = _guild(fake, app, p["guild_id"])
    if guild is None:
        return _missing()
    bot_of = {a.bot_user_id: a for a in fake.applications.values() if a.id in guild.bots}
    if p["user_id"] in bot_of:
        found = bot_of[p["user_id"]]
        user = {"id": found.bot_user_id, "username": found.name, "bot": True}
        return JSONResponse({"user": user, "roles": guild.bot_roles.get(found.id, [])})
    if p["user_id"] in guild.members:
        return JSONResponse(guild.members[p["user_id"]])
    return _error(404, "Unknown Member", 10007)


async def put_overwrite(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    found = fake.channel(p["channel_id"])
    if found is None or app.id not in found[0].bots:
        return _error(404 if found is None else 403, "Unknown Channel", 10003)
    overwrites = [o for o in found[1]["permission_overwrites"] if o["id"] != p["overwrite_id"]]
    overwrites.append({"id": p["overwrite_id"], **(body or {})})
    found[1]["permission_overwrites"] = overwrites
    return Response(status_code=204)


ROUTES = [
    ("GET", "/applications/@me", application),
    ("GET", "/guilds/{guild_id}/channels", channels),
    ("POST", "/guilds/{guild_id}/channels", create_channel),
    ("GET", "/guilds/{guild_id}/roles", roles),
    ("POST", "/guilds/{guild_id}/roles", create_role),
    ("GET", "/guilds/{guild_id}/members/{user_id}", member),
    ("PUT", "/channels/{channel_id}/permissions/{overwrite_id}", put_overwrite),
]
