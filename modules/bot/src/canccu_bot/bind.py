"""Binding the event's guild through Discord's bot install (contracts/bot.md, Binding a guild).

The start keeps a random `state` in Valkey for 10 minutes, with the event, the caller and the
application; the browser carries only the random value, and the callback takes it once. The
callback trusts nothing from its query but the code: the guild comes from Discord's answer to the
code exchange, and the person's own guild list proves Manage Server, because the bot may already
be in the guild from an earlier binding. The checks that read the platform run again in the
transaction that binds, and both rules are unique keys, so of two racing binds one wins."""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode

import asyncpg
from canccu_kit import KitError, SecretUndecryptable, tenant_scope
from canccu_kit.access import TenantContext
from starlette.datastructures import QueryParams
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from . import commands, store
from .access import deps, event_admin
from .bind_page import result_page
from .client import iso
from .credentials import SNOWFLAKE, bad, conflict
from .deps import Deps
from .discord_api import DiscordRefused, manages
from .guild import audit
from .look import set_nickname

log = logging.getLogger("canccu_bot.bind")

STATE_TTL = timedelta(minutes=10)
SCOPES = "bot applications.commands identify guilds"
BOT_PERMISSIONS = (1 << 10) | (1 << 11) | (1 << 14) | (1 << 16)
"""View channels, send messages, embed links, read message history: what posting needs. The
features that need more ask for it when their setup comes (step 6, link 5)."""


def state_key(state: str) -> str:
    # Only the digest is a key: a key listing never shows a state a browser could use.
    return f"bot:bind:{hashlib.sha256(state.encode()).hexdigest()}"


def unavailable(message: str) -> KitError:
    return KitError(message, status=503, code="discord_not_configured")


async def _preselect(request: Request) -> str | None:
    raw = await request.body()
    if not raw:
        return None
    try:
        body = json.loads(raw)
    except ValueError:
        raise bad("the body is not JSON") from None
    if not isinstance(body, dict) or not set(body) <= {"guild_id"}:
        raise bad("an object with guild_id only")
    guild = body.get("guild_id")
    if guild is not None and (not isinstance(guild, str) or not SNOWFLAKE.fullmatch(guild)):
        raise bad("guild_id: a Discord guild id")
    return guild


async def start_bind(request: Request) -> Response:
    d = deps(request)
    ctx, session = await event_admin(request)
    guild = await _preselect(request)
    async with d.db.tenant() as conn:
        row = await store.connection(conn)
        bound = await store.binding(conn)
    if bound is not None:
        raise conflict("guild_bound", "the event already has a guild")
    if row is not None and row["mode"] == "own":
        if not (row["bot_token_set"] and row["client_secret_set"]):
            raise conflict("connection_incomplete", "the own application needs both credentials")
        app_id = row["application_id"]
    elif d.shared is not None:
        app_id = d.shared.application_id
    else:
        raise unavailable("this platform has no shared Discord bot")
    redirect = d.hosts.callback_uri()
    if redirect is None:
        raise unavailable("this platform has no address for Discord to come back to")
    state = secrets.token_urlsafe(32)
    started = {
        "tenant": ctx["tenant_id"],
        "user": session.user_id,
        "application_id": app_id,
        "revision": 0 if row is None else row["revision"],
    }
    ttl_ms = int(STATE_TTL.total_seconds() * 1000)
    await d.keys.put(state_key(state), json.dumps(started), ttl_ms)
    query = {
        "client_id": app_id,
        "scope": SCOPES,
        "permissions": str(BOT_PERMISSIONS),
        "response_type": "code",
        "redirect_uri": redirect,
        "state": state,
    }
    if guild is not None:
        query["guild_id"] = guild
    return JSONResponse(
        {
            "authorize_url": f"{d.discord.authorize_url}?{urlencode(query)}",
            "expires_at": iso(d.now() + STATE_TTL),
        }
    )


async def _credentials(d: Deps, tenant: str, started: dict[str, Any]) -> tuple[str, str] | None:
    """The application's token and secret, or None when the connection changed since the start."""
    app_id = started["application_id"]
    async with d.db.tenant(tenant) as conn:
        row = await conn.fetchrow(
            "SELECT mode, application_id, bot_token, client_secret, revision FROM bot_connections"
        )
    if (0 if row is None else row["revision"]) != started["revision"]:
        return None
    if row is None or row["mode"] == "shared":
        if d.shared is None or d.shared.application_id != app_id:
            return None
        return d.shared.token, d.shared.client_secret
    if row["application_id"] != app_id or row["bot_token"] is None or row["client_secret"] is None:
        return None
    box = d.secrets
    try:
        token = box.open_text(row["bot_token"], store.token_aad(tenant, app_id))
        secret = box.open_text(row["client_secret"], store.secret_aad(tenant, app_id))
    except SecretUndecryptable:
        log.error("the credentials of application %s do not open", app_id)
        return None
    return token, secret


async def _proven(
    d: Deps, started: dict[str, Any], creds: tuple[str, str], code: str
) -> dict[str, Any] | str:
    """The guild Discord added the bot to, or the check that failed. The person's access token
    lives only in this call: used for these checks, then dropped, never stored."""
    token, secret = creds
    redirect = d.hosts.callback_uri() or ""
    try:
        answer = await d.discord.exchange(started["application_id"], secret, code, redirect)
        guild = answer.get("guild")
        if not isinstance(guild, dict) or not SNOWFLAKE.fullmatch(str(guild.get("id", ""))):
            return "bot_not_in_guild"
        guild_id = str(guild["id"])
        person, guilds = await d.discord.person(str(answer.get("access_token", "")))
        expected = await d.users.discord_id(started["user"])
        if expected is None or person != expected:
            return "discord_user_mismatch"
        entry = next((g for g in guilds if str(g.get("id")) == guild_id), None)
        if entry is None or not manages(entry):
            return "manage_server_required"
        if not await d.discord.bot_in_guild(token, guild_id):
            return "bot_not_in_guild"
    except DiscordRefused as refused:
        return refused.code
    return {"id": guild_id, "name": str(guild.get("name") or "")[:100]}


async def _bind(d: Deps, tenant: str, started: dict[str, Any], guild: dict[str, Any]) -> str:
    """The platform's checks again and the bind, in one transaction."""
    app_id = started["application_id"]
    with tenant_scope(tenant):
        try:
            async with d.db.tenant(tenant) as conn:
                row = await conn.fetchrow(
                    "SELECT mode, application_id, revision FROM bot_connections FOR UPDATE"
                )
                own = row is not None and row["mode"] == "own"
                now_app = row["application_id"] if own else (d.shared and d.shared.application_id)
                if (0 if row is None else row["revision"]) != started["revision"] or (
                    now_app != app_id
                ):
                    return "connection_changed"
                if await store.binding(conn) is not None:
                    return "guild_bound"
                await conn.execute(
                    "INSERT INTO bot_bindings (guild_id, guild_name, application_id, bound_by,"
                    " bound_at) VALUES ($1, $2, $3, $4, $5)",
                    guild["id"],
                    guild["name"],
                    app_id,
                    started["user"],
                    d.now(),
                )
                await conn.execute(
                    "INSERT INTO bot_guild_routes (guild_id, tenant_id, application_id)"
                    " VALUES ($1, $2, $3)",
                    guild["id"],
                    tenant,
                    app_id,
                )
                data = {
                    "guild_id": guild["id"],
                    "guild_name": guild["name"],
                    "application_id": app_id,
                    "actor_user_id": started["user"],
                }
                await d.outbox.add(conn, "bot.guild.bound", data, version=1)
        except asyncpg.UniqueViolationError:
            return "guild_bound"  # another bind won the event or the guild
        await d.outbox.flush(tenant)
    return "ok"


async def finish(d: Deps, ctx: TenantContext, started: dict[str, Any], query: QueryParams) -> str:
    """The outcome: `ok` or the error code the event's admin pages show."""
    code = query.get("code")
    if query.get("error") or not code:
        return "access_denied"
    if ctx["status"] == "archived":
        return "event_archived"
    tenant = ctx["tenant_id"]
    creds = await _credentials(d, tenant, started)
    if creds is None:
        return "connection_changed"
    guild = await _proven(d, started, creds, code)
    if isinstance(guild, str):
        return guild
    outcome = await _bind(d, tenant, started, guild)
    if outcome == "ok":
        changes = {"application_id": started["application_id"]}
        await audit(d, tenant, started["user"], "bot.guild.bound", changes, "guild", guild["id"])
        await commands.register(d, ctx)
        await set_nickname(d, ctx)
    return outcome


async def install_callback(request: Request) -> Response:
    d = deps(request)
    if not d.hosts.is_callback_host(request):
        raise KitError("not found", status=404, code="not_found")
    state = request.query_params.get("state", "")
    raw = await d.keys.take(state_key(state)) if 16 <= len(state) <= 128 else None
    started = json.loads(raw) if raw else None
    ctx = await d.tenants.by_id(started["tenant"]) if started else None
    if started is None or ctx is None:
        return result_page("state_invalid", 400)
    outcome = await finish(d, ctx, started, request.query_params)
    if outcome != "ok":
        log.info("a bind of %s ended with %s", ctx["tenant_id"], outcome)
    if ctx["primary_hostname"]:
        url = d.hosts.event_url(ctx["primary_hostname"], f"/bot/?{urlencode({'bind': outcome})}")
        return RedirectResponse(url, status_code=303)
    return result_page(outcome, 200)


ROUTES = [
    Route("/api/bot/guild/bind", start_bind, methods=["POST"]),
    Route("/api/bot/install/callback", install_callback, methods=["GET"]),
]
