"""`/internal/tenants/…`: for the kit, the other modules and Caddy's `ask`. The edge Caddy routes
only `/api/<module>/`, so these are reached on the stack's internal network only."""

from __future__ import annotations

from typing import Any

from canccu_kit import DEMO_TENANT, ServiceForbidden, TenantContext
from canccu_kit.resolve import normalize_host
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import audit, core, model
from .db import Db
from .deps import deps
from .model import bad_request, body_of, not_found
from .venues import internal_venue


async def resolve_host(db: Db, raw: str | None, declared: dict[str, bool]) -> TenantContext | None:
    """Exact match on an `active` hostname (contracts/tenants.md, Resolving the tenant). The same
    function serves the kit's lookups and this module's own requests."""
    host = normalize_host(raw)
    if host is None:
        return None
    async with db.platform() as conn:
        tid = await conn.fetchval(
            "SELECT tenant_id FROM hostnames WHERE hostname = $1 AND status = 'active'", host
        )
    if tid is None:
        return None
    async with db.tenant(tid) as conn:
        return await core.tenant_context(conn, tid, declared)


async def demo_context(db: Db, declared: dict[str, bool]) -> TenantContext | None:
    """IP mode serves the demo tenant only while it is the only tenant (0013 item 2)."""
    async with db.platform() as conn:
        ids = [r["id"] for r in await conn.fetch("SELECT id FROM tenants LIMIT 2")]
    if ids != [DEMO_TENANT]:
        return None
    async with db.tenant(DEMO_TENANT) as conn:
        return await core.tenant_context(conn, DEMO_TENANT, declared)


async def ip_mode(request: Request) -> Response:
    """The demo tenant for the kit's IP mode, so no module needs a loader of its own
    (contracts/tenants.md, Resolving the tenant)."""
    d = deps(request)
    ctx = await demo_context(d.db, d.declared_flags) if request.app.state.ip_mode else None
    if ctx is None:
        raise not_found()
    return JSONResponse(ctx)


async def resolve(request: Request) -> Response:
    d = deps(request)
    raw = request.query_params.get("host")
    if not raw or normalize_host(raw) != raw or not model.HOSTNAME_RE.fullmatch(raw):
        raise bad_request("host: a lowercase hostname without a port")
    ctx = await resolve_host(d.db, raw, d.declared_flags)
    if ctx is None:
        raise not_found()
    return JSONResponse(ctx)


async def ask(request: Request) -> Response:
    d = deps(request)
    host = normalize_host(request.query_params.get("domain"))
    async with d.db.platform() as conn:
        found = host and await conn.fetchval(
            "SELECT 1 FROM hostnames WHERE hostname = $1 AND status = 'active'", host
        )
    if not found:
        raise not_found()
    return Response(status_code=200)


async def append_audit(request: Request) -> Response:
    d = deps(request)
    body = await body_of(request)
    entry = audit.check_append(body)
    # The service identity names the caller: a module appends only in its own name.
    if entry["module"] != request.state.service:
        raise ServiceForbidden("a module appends audit entries only in its own name")
    tid = body.get("tenant_id")
    actor: dict[str, Any]
    if tid is None:
        async with d.db.platform() as conn:
            actor = await _actor(conn, entry)
            stored = await _append(conn, None, actor, entry)
    else:
        tid = model.check_tenant_id(tid)
        # Allowed also for archived events: the log's own appends are not writes of the event.
        async with d.db.tenant(tid) as conn:
            await core.tenant_row(conn, tid)
            actor = await _actor(conn, entry)
            stored = await _append(conn, tid, actor, entry)
    return JSONResponse(stored, status_code=201)


async def _actor(conn: Any, entry: dict[str, Any]) -> dict[str, Any]:
    if entry["actor_user_id"] is None:
        return audit.module_actor(entry["module"])
    return await audit.user_actor(conn, entry["actor_user_id"])


async def _append(conn: Any, tid: str | None, actor: dict[str, Any], e: dict[str, Any]) -> Any:
    return await audit.append(
        conn, tid, actor, e["action"], e["target"], e["changes"], e["reason"], e["correlation_id"]
    )


ROUTES = [
    Route("/internal/tenants/resolve", resolve, methods=["GET"]),
    Route("/internal/tenants/ask", ask, methods=["GET"]),
    Route("/internal/tenants/ip-mode", ip_mode, methods=["GET"]),
    Route("/internal/tenants/venues/{venue_id}", internal_venue, methods=["GET"]),
    Route("/internal/tenants/audit", append_audit, methods=["POST"]),
]
