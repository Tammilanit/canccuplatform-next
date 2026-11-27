"""Clone (contracts/bot.md, Clone): the last event of a series hands its connection and binding
to the new one, so a series keeps its Discord server and its own application without a new
install. It moves, never copies: the source falls back to the shared bot with no guild."""

from __future__ import annotations

from typing import Any

from canccu_kit import KitError, MissingRight, is_tenant_id, tenant_scope
from canccu_kit.db import TENANT_SETTING
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import commands, store
from .access import deps, event_admin
from .connection import view
from .credentials import bad, conflict
from .deps import Deps
from .guild import audit


async def _switch(conn: Any, tenant: str) -> None:
    """The move's two events in one transaction: the contract wants the routes rewritten with
    the rows, so no gateway event finds the guild between two events. Only this module's own
    rows of exactly these two events are touched while the setting points at each."""
    await conn.execute(f"SELECT set_config('{TENANT_SETTING}', $1, true)", tenant)


async def _take(d: Deps, conn: Any, source: str, target: str) -> tuple[Any, Any, dict[str, str]]:
    """The source's own connection (with its credentials sealed again for the target) and its
    binding, both removed from the source; the source's events go on its stream."""
    row = await conn.fetchrow("SELECT * FROM bot_connections WHERE mode = 'own' FOR UPDATE")
    bound = await conn.fetchrow("SELECT * FROM bot_bindings FOR UPDATE")
    sealed: dict[str, str] = {}
    if row is not None:
        app_id = row["application_id"]
        for name, aad in (("bot_token", store.token_aad), ("client_secret", store.secret_aad)):
            if row[name] is not None:
                plain = d.secrets.open_text(row[name], aad(source, app_id))
                sealed[name] = d.secrets.seal(plain, aad(target, app_id))
        await conn.execute(
            "UPDATE bot_connections SET mode = 'shared', application_id = NULL, bot_token = NULL,"
            " client_secret = NULL, key_version = NULL, updated_at = NULL, updated_by = NULL,"
            " revision = revision + 1"
        )
    if bound is not None:
        await conn.execute("DELETE FROM bot_bindings")
    return row, bound, sealed


async def _emit(
    d: Deps, conn: Any, mode: str, app_id: str | None, revision: int, actor: str | None
) -> None:
    shown = app_id or (d.shared.application_id if d.shared else None)
    data = {
        "mode": mode,
        "application_id": shown,
        "changed": ["mode", "application_id", "bot_token", "client_secret"],
        "revision": revision,
        "actor_user_id": actor,
    }
    await d.outbox.add(conn, "bot.connection.changed", data, version=1)


async def move(d: Deps, source: str, target: str, actor: str | None) -> tuple[bool, bool]:
    """(moved_connection, moved_binding); 409 `already_connected` when the target has its own."""
    with tenant_scope(source):
        async with d.db.tenant(source) as conn:
            row, bound, sealed = await _take(d, conn, source, target)
            if row is not None:
                await _emit(d, conn, "shared", None, row["revision"] + 1, actor)
            if bound is not None:
                data = {"guild_id": bound["guild_id"], "reason": "moved", "actor_user_id": actor}
                await d.outbox.add(conn, "bot.guild.unbound", data, version=1)
            await _switch(conn, target)
            with tenant_scope(target):
                await _give(d, conn, target, row, bound, sealed, actor)
    for tenant in (source, target):
        await d.outbox.flush(tenant)
    return row is not None, bound is not None


async def _give(
    d: Deps,
    conn: Any,
    target: str,
    row: Any,
    bound: Any,
    sealed: dict[str, str],
    actor: str | None,
) -> None:
    mine = await conn.fetchrow("SELECT mode, revision FROM bot_connections FOR UPDATE")
    if (row is not None and mine is not None and mine["mode"] == "own") or (
        bound is not None and await store.binding(conn) is not None
    ):
        raise conflict("already_connected", "this event already has its own bot or guild")
    if row is not None:
        app_id = row["application_id"]
        revision = (0 if mine is None else mine["revision"]) + 1
        await conn.execute(
            "INSERT INTO bot_connections (mode, application_id, bot_token, client_secret,"
            " key_version, updated_at, updated_by, revision)"
            " VALUES ('own', $1, $2, $3, $4, now(), $5, $6) ON CONFLICT (tenant_id) DO UPDATE"
            " SET mode = 'own', application_id = $1, bot_token = $2, client_secret = $3,"
            " key_version = $4, updated_at = now(), updated_by = $5, revision = $6",
            app_id,
            sealed.get("bot_token"),
            sealed.get("client_secret"),
            d.secrets.current,
            actor,
            revision,
        )
        await conn.execute(
            "UPDATE bot_application_routes SET tenant_id = $1 WHERE application_id = $2",
            target,
            app_id,
        )
        await _emit(d, conn, "own", app_id, revision, actor)
    if bound is not None:
        await conn.execute(
            "INSERT INTO bot_bindings (guild_id, guild_name, application_id, bound_by, bound_at)"
            " VALUES ($1, $2, $3, $4, $5)",
            bound["guild_id"],
            bound["guild_name"],
            bound["application_id"],
            bound["bound_by"],  # the Manage Server proof stays the one made at the bind
            bound["bound_at"],
        )
        await conn.execute(
            "UPDATE bot_guild_routes SET tenant_id = $1, application_id = $2 WHERE guild_id = $3",
            target,
            bound["application_id"],
            bound["guild_id"],
        )
        data = {
            "guild_id": bound["guild_id"],
            "guild_name": bound["guild_name"],
            "application_id": bound["application_id"],
            "actor_user_id": actor,
        }
        await d.outbox.add(conn, "bot.guild.bound", data, version=1)


async def clone(request: Request) -> Response:
    d = deps(request)
    ctx, session = await event_admin(request)  # 409 event_archived for an archived target
    try:
        body = await request.json()
    except ValueError:
        body = None
    source = body.get("source_tenant_id") if isinstance(body, dict) else None
    if set(body or {}) != {"source_tenant_id"} or not isinstance(source, str):
        raise bad("an object with source_tenant_id only")
    target = ctx["tenant_id"]
    host = request.url.hostname or ""
    cookie = request.headers.get("cookie")
    if not is_tenant_id(source) or source == target:
        raise MissingRight("the source must be another event of this series")
    if not await d.series.admin_of_both(host, cookie, source, target):
        raise MissingRight("needs the event-admin role on both events of one series")
    source_ctx = await d.tenants.by_id(source)
    if source_ctx is None:
        raise MissingRight("the source must be another event of this series")
    if source_ctx["status"] == "live":
        raise KitError("an event that is on keeps its bot", status=409, code="source_live")
    moved_connection, moved_binding = await move(d, source, target, session.user_id)
    if moved_connection or moved_binding:
        changes = {"from": source, "to": target, "moved_connection": moved_connection}
        for tenant in (source, target):
            await audit(d, tenant, session.user_id, "bot.connection.moved", changes, "connection")
    if moved_binding:
        await commands.register(d, ctx)
    async with d.db.tenant() as conn:
        connection = await view(d, conn)
    return JSONResponse(
        {
            "moved_connection": moved_connection,
            "moved_binding": moved_binding,
            "connection": connection,
        }
    )


ROUTES = [Route("/api/bot/clone", clone, methods=["POST"])]
