"""Writing the event's connection (contracts/bot.md, The event's connection): bring an own
application, rotate one of its credentials, or go back to the shared bot.

Both credentials are checked with Discord before anything is stored, outside the transaction;
the transaction then checks the revision again, so a change made meanwhile wins and this one is
`version_conflict`. The pool opens or closes the own client on its next tick, from the routes."""

from __future__ import annotations

import logging
import re
from typing import Any

import asyncpg
from canccu_kit import KitError, SecretBox
from canccu_kit.rights import Session
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import store
from .access import deps, event_admin
from .connection import view
from .deps import Deps
from .discord_api import DiscordRefused
from .guild import audit

log = logging.getLogger("canccu_bot.credentials")

SNOWFLAKE = re.compile(r"^[0-9]{17,20}$")
FIELDS = {"mode", "application_id", "bot_token", "client_secret", "revision"}


def bad(message: str, code: str = "invalid_request") -> KitError:
    return KitError(message, status=400, code=code)


def conflict(code: str, message: str) -> KitError:
    return KitError(message, status=409, code=code)


def _revision(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise bad("revision: the connection's revision you read")
    return value


def parse(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict) or not set(body) <= FIELDS:
        raise bad(f"an object with {', '.join(sorted(FIELDS))} only")
    mode = body.get("mode")
    if mode not in ("shared", "own"):
        raise bad("mode: shared or own")
    out: dict[str, Any] = {"mode": mode, "revision": _revision(body.get("revision"))}
    if mode == "shared":
        if set(body) & {"application_id", "bot_token", "client_secret"}:
            raise bad("the shared bot takes no application or credentials")
        return out
    app_id = body.get("application_id")
    if not isinstance(app_id, str) or not SNOWFLAKE.fullmatch(app_id):
        raise bad("application_id: the own application's id")
    out["application_id"] = app_id
    for name, low, high in (("bot_token", 50, 200), ("client_secret", 16, 128)):
        value = body.get(name)
        if value is None:
            continue
        if not isinstance(value, str) or not low <= len(value) <= high:
            raise bad(f"{name}: {low} to {high} characters")
        out[name] = value
    return out


async def _json(request: Request) -> Any:
    try:
        return await request.json()
    except ValueError:
        raise bad("the body is not JSON") from None


def _stale(row: Any, revision: int) -> None:
    if (0 if row is None else row["revision"]) != revision:
        raise conflict("version_conflict", "the connection changed since you read it")


async def _check_own(d: Deps, tenant: str, want: dict[str, Any]) -> list[str]:
    """Refusals that need no Discord, then both credentials with Discord; the names of what
    changes."""
    app_id = want["application_id"]
    if d.shared is not None and app_id == d.shared.application_id:
        raise conflict("application_reserved", "this is the platform's shared bot")
    async with d.db.tenant() as conn:
        row = await store.connection(conn)
        _stale(row, want["revision"])
        bound = await store.binding(conn)
        holder = await conn.fetchval(
            "SELECT tenant_id FROM bot_application_routes WHERE application_id = $1", app_id
        )
    same = row is not None and row["mode"] == "own" and row["application_id"] == app_id
    if holder is not None and holder != tenant:
        raise conflict("application_taken", "another event holds this application")
    if not same:
        if bound is not None:
            raise conflict("guild_bound", "unbind the guild before changing the application")
        if "bot_token" not in want or "client_secret" not in want:
            raise bad("a new application needs bot_token and client_secret")
    if same and "bot_token" not in want and "client_secret" not in want:
        raise bad("bot_token, client_secret or both: nothing else changes")
    changed = [] if same else ["mode", "application_id"]
    if row is not None and row["mode"] == "own" and not same:
        changed = ["application_id"]
    try:
        if "bot_token" in want:
            await d.discord.check_token(want["bot_token"], app_id)
            changed.append("bot_token")
        if "client_secret" in want:
            await d.discord.check_secret(app_id, want["client_secret"])
            changed.append("client_secret")
    except DiscordRefused as refused:
        if refused.code == "discord_unavailable":
            raise KitError(
                "Discord did not answer", status=503, code="discord_unavailable"
            ) from None
        raise bad("Discord refused the credential", refused.code) from None
    return changed


def _sealed(box: SecretBox, tenant: str, app_id: str, want: dict[str, Any]) -> dict[str, str]:
    """Only what the request brings; the other credential keeps its stored value."""
    out: dict[str, str] = {}
    if "bot_token" in want:
        out["bot_token"] = box.seal(want["bot_token"], store.token_aad(tenant, app_id))
    if "client_secret" in want:
        out["client_secret"] = box.seal(want["client_secret"], store.secret_aad(tenant, app_id))
    return out


async def _store_own(
    d: Deps, conn: Any, tenant: str, session: Session, want: dict[str, Any], changed: list[str]
) -> None:
    app_id = want["application_id"]
    row = await conn.fetchrow("SELECT revision FROM bot_connections FOR UPDATE")
    _stale(row, want["revision"])
    sealed = _sealed(d.secrets, tenant, app_id, want)
    revision = want["revision"] + 1
    await conn.execute(
        "INSERT INTO bot_connections (mode, application_id, bot_token, client_secret, key_version,"
        " updated_at, updated_by, revision) VALUES ('own', $1, $2, $3, $4, now(), $5, $6)"
        " ON CONFLICT (tenant_id) DO UPDATE SET mode = 'own', application_id = $1,"
        " bot_token = COALESCE($2, bot_connections.bot_token),"
        " client_secret = COALESCE($3, bot_connections.client_secret), key_version = $4,"
        " updated_at = now(), updated_by = $5, revision = $6",
        app_id,
        sealed.get("bot_token"),
        sealed.get("client_secret"),
        d.secrets.key_version(next(iter(sealed.values()))),
        session.user_id,
        revision,
    )
    await conn.execute(
        "DELETE FROM bot_application_routes WHERE tenant_id = $1 AND application_id <> $2",
        tenant,
        app_id,
    )
    try:
        await conn.execute(
            "INSERT INTO bot_application_routes (application_id, tenant_id) VALUES ($1, $2)"
            " ON CONFLICT (application_id) DO NOTHING",
            app_id,
            tenant,
        )
    except asyncpg.UniqueViolationError:
        raise conflict("application_taken", "another event holds this application") from None
    holder = await conn.fetchval(
        "SELECT tenant_id FROM bot_application_routes WHERE application_id = $1", app_id
    )
    if holder != tenant:  # another event took it between the check and this write
        raise conflict("application_taken", "another event holds this application")
    await _changed(d, conn, "own", app_id, changed, revision, session.user_id)


async def _changed(
    d: Deps,
    conn: Any,
    mode: str,
    app_id: str | None,
    changed: list[str],
    revision: int,
    actor: str | None,
) -> None:
    shown = app_id if app_id is not None else (d.shared.application_id if d.shared else None)
    data = {
        "mode": mode,
        "application_id": shown,
        "changed": changed,
        "revision": revision,
        "actor_user_id": actor,
    }
    await d.outbox.add(conn, "bot.connection.changed", data, version=1)


async def to_shared(d: Deps, conn: Any, revision: int, actor: str | None) -> list[str]:
    """Back to the shared bot in the caller's transaction: the credentials are erased and the
    application is free for another event. Returns what changed (nothing when already shared)."""
    row = await conn.fetchrow(
        "SELECT mode, application_id, revision FROM bot_connections FOR UPDATE"
    )
    _stale(row, revision)
    if row is None or row["mode"] == "shared":
        return []
    if await store.binding(conn) is not None:
        raise conflict("guild_bound", "unbind the guild before going back to the shared bot")
    # No user stays on a shared row: the user-deleted sweep then finds every user id through
    # the routes (lifecycle.py).
    await conn.execute(
        "UPDATE bot_connections SET mode = 'shared', application_id = NULL, bot_token = NULL,"
        " client_secret = NULL, key_version = NULL, updated_at = NULL, updated_by = NULL,"
        " revision = revision + 1"
    )
    await conn.execute(
        "DELETE FROM bot_application_routes WHERE application_id = $1", row["application_id"]
    )
    changed = ["mode", "application_id", "bot_token", "client_secret"]
    await _changed(d, conn, "shared", None, changed, row["revision"] + 1, actor)
    return changed


async def put_connection(request: Request) -> Response:
    d = deps(request)
    body = await _json(request)
    own = isinstance(body, dict) and body.get("mode") == "own"
    ctx, session = await event_admin(request, writable=own)  # shared also on an archived event
    want = parse(body)
    tenant = ctx["tenant_id"]
    if want["mode"] == "own":
        changed = await _check_own(d, tenant, want)
        async with d.db.tenant() as conn:
            await _store_own(d, conn, tenant, session, want, changed)
    else:
        async with d.db.tenant() as conn:
            changed = await to_shared(d, conn, want["revision"], session.user_id)
    return await _done(d, tenant, session, changed)


async def delete_connection(request: Request) -> Response:
    d = deps(request)
    raw = request.query_params.get("revision", "")
    if not raw.isdigit():
        raise bad("revision: the connection's revision you read")
    ctx, session = await event_admin(request, writable=False)
    async with d.db.tenant() as conn:
        changed = await to_shared(d, conn, int(raw), session.user_id)
    return await _done(d, ctx["tenant_id"], session, changed)


async def _done(d: Deps, tenant: str, session: Session, changed: list[str]) -> Response:
    if changed:
        await audit(
            d, tenant, session.user_id, "bot.connection.changed", {"changed": changed}, "connection"
        )
    await d.outbox.flush(tenant)
    async with d.db.tenant() as conn:
        return JSONResponse(await view(d, conn))


ROUTES = [
    Route("/api/bot/connection", put_connection, methods=["PUT"]),
    Route("/api/bot/connection", delete_connection, methods=["DELETE"]),
]
