"""`GET /api/bot/connection` (contracts/bot.md, The event's connection). The client's status comes
from the status board, so any container answers for a client another one holds."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from canccu_kit import KitError
from canccu_kit.access import TenantContext, check_admin_access, tailscale_cidrs
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import store
from .client import iso
from .deps import Deps

READ = "bot.connection.read"


def deps(request: Request) -> Deps:
    found: Deps = request.app.state.deps
    return found


def tenant_of(request: Request) -> TenantContext:
    ctx: TenantContext | None = request.state.tenant
    if ctx is None:  # a platform hostname names no event
        raise KitError("not found", status=404, code="not_found")
    return ctx


def _time(value: datetime | None) -> str | None:
    return None if value is None else iso(value)


async def get_connection(request: Request) -> Response:
    d = deps(request)
    ctx = tenant_of(request)
    await d.rights.check(request.headers.get("cookie"), READ)
    # uvicorn sets the client from X-Forwarded-For only for the proxies it trusts (main.py).
    client_ip = request.client.host if request.client else None
    check_admin_access(ctx, client_ip, tailscale_cidrs())  # 403 admin_access_restricted
    async with d.db.tenant() as conn:
        row = await store.connection(conn)
        bound = await store.binding(conn)
    own = row is not None and row["mode"] == "own"
    if own:
        application_id = row["application_id"]
    elif d.shared is not None:
        application_id = d.shared.application_id
    else:
        raise KitError(
            "this platform has no shared Discord bot", status=503, code="discord_not_configured"
        )
    seen = await d.board.read(application_id)
    client: dict[str, Any] = {
        "status": "connecting",
        "error_code": None,
        "since": iso(datetime.now(UTC)),
    }
    if seen is not None:
        client = {k: seen[k] for k in ("status", "error_code", "since")}
    credentials = None
    if own:
        credentials = {
            "bot_token_set": row["bot_token_set"],
            "client_secret_set": row["client_secret_set"],
            "updated_at": _time(row["updated_at"]),
            "updated_by": row["updated_by"],
        }
    return JSONResponse(
        {
            "mode": "own" if own else "shared",
            "application_id": application_id,
            "bot_user": None if seen is None else seen.get("bot_user"),
            "credentials": credentials,
            "client": client,
            "guild": None if bound is None else _binding(bound),
            "revision": 0 if row is None else row["revision"],
        }
    )


def _binding(row: Any) -> dict[str, Any]:
    return {
        "guild_id": row["guild_id"],
        "guild_name": row["guild_name"],
        "application_id": row["application_id"],
        "bound_by": row["bound_by"],
        "bound_at": _time(row["bound_at"]),
        "commands": {
            "status": row["commands_status"],
            "flags_version": row["commands_flags_version"],
            "registered_at": _time(row["commands_registered_at"]),
            "error_code": row["commands_error_code"],
        },
    }


ROUTES = [Route("/api/bot/connection", get_connection, methods=["GET"])]
