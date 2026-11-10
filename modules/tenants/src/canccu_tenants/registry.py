"""The superadmin's registry: tenants and the platform audit (contracts/tenants.md, Superadmin).

Every path here answers 404 on any hostname but the superadmin's (Caller.superadmin).
"""

from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import audit, core, model
from .deps import deps
from .model import bad_request, body_of, conflict, not_found

DEFAULT_QUOTA = 2_147_483_648
"""2 GiB, as the column's default (migrations/002_storage.sql)."""


async def list_tenants(request: Request) -> Response:
    d = deps(request)
    await d.caller.superadmin(request)
    async with d.db.platform() as conn:
        ids = [r["id"] for r in await conn.fetch("SELECT id FROM tenants ORDER BY id")]
        tenants = [await core.full_tenant(conn, tid) for tid in ids]
    return JSONResponse({"tenants": tenants})


async def create_tenant(request: Request) -> Response:
    d = deps(request)
    session = await d.caller.superadmin(request)
    body = await body_of(request)
    tid = model.check_tenant_id(body.get("id"))
    name = model.check_name(body.get("name"))
    zone = model.check_time_zone(body.get("time_zone"))
    starts = model.parse_time(body.get("starts_at"), "starts_at")
    ends = model.parse_time(body.get("ends_at"), "ends_at")
    if starts and ends and ends < starts:
        raise bad_request("ends_at is before starts_at")
    venue_id = body.get("venue_id")
    series_id = body.get("series_id")
    for value, field in ((venue_id, "venue_id"), (series_id, "series_id")):
        if value is not None:
            model.check_id(value, field)
    quota = model.check_storage_bytes(
        body.get("storage_quota_bytes", DEFAULT_QUOTA), "storage_quota_bytes"
    )
    admins = body.get("admin_user_ids", [])
    if not isinstance(admins, list) or not all(isinstance(a, str) for a in admins):
        raise bad_request("admin_user_ids: a list of user ids")
    outbox = core.Outbox()
    async with d.db.tenant(tid) as conn:
        # Ids are never reused, so held hostnames and old links never reach a new event.
        held = await conn.fetchval("SELECT 1 FROM hostnames WHERE tenant_id = $1 LIMIT 1", tid)
        if held or await conn.fetchval("SELECT 1 FROM tenants WHERE id = $1", tid):
            raise conflict("tenant_exists", "this id is or was in use")
        if venue_id and not await conn.fetchval("SELECT 1 FROM venues WHERE id = $1", venue_id):
            raise not_found()
        await conn.execute(
            "INSERT INTO tenants (id, name, time_zone, starts_at, ends_at, venue_id, series_id,"
            " storage_quota_bytes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            tid,
            name,
            zone,
            starts,
            ends,
            venue_id,
            series_id,
            quota,
        )
        actor = await audit.user_actor(conn, session.user_id)
        await audit.append(
            conn,
            None,
            actor,
            "tenants.tenant.created",
            {"type": "tenant", "id": tid},
            {"name": name},
        )
        outbox.platform("tenants.tenant.created", {"tenant_id": tid, "status": "draft"})
        for user_id in admins:
            if not await conn.fetchval("SELECT 1 FROM users WHERE id = $1", user_id):
                raise not_found()
            await conn.execute(
                "INSERT INTO event_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING", user_id
            )
            await audit.append(
                conn, tid, actor, "tenants.admin.added", {"type": "user", "id": user_id}
            )
            outbox.tenant(
                tid, "tenants.admin.added", {"user_id": user_id, "actor_user_id": session.user_id}
            )
        if venue_id:
            changed = await core.copy_venue_in(conn, tid, venue_id, d.files, actor, outbox)
            outbox.tenant(
                tid,
                "tenants.venue_info.changed",
                {
                    "changed": changed,
                    "copied": True,
                    "actor_user_id": session.user_id,
                },
            )
        result = await core.full_tenant(conn, tid)
    await outbox.publish(d.bus)
    return JSONResponse(result, status_code=201)


async def get_tenant(request: Request) -> Response:
    d = deps(request)
    await d.caller.superadmin(request)
    async with d.db.platform() as conn:
        result = await core.full_tenant(conn, request.path_params["tenant_id"])
    return JSONResponse(result)


async def _registry_write(request: Request, action: str) -> Response:
    d = deps(request)
    session = await d.caller.superadmin(request)
    body = await body_of(request)
    tid = request.path_params["tenant_id"]
    outbox = core.Outbox()
    async with d.db.platform() as conn:
        if not await conn.fetchval("SELECT 1 FROM tenants WHERE id = $1", tid):
            raise not_found()
    async with d.db.tenant(tid) as conn:
        actor = await audit.user_actor(conn, session.user_id)
        if action == "patch":
            # The quota is the superadmin's alone: event admins never set it (current.py).
            allowed = (
                core.EVENT_FIELDS
                | core.ACCESS_FIELDS
                | {
                    "venue_id",
                    "series_id",
                    "storage_quota_bytes",
                }
            )
            await core.patch_tenant(
                conn, tid, body, allowed, actor, session.user_id, d.files, outbox
            )
        else:
            await core.change_status(conn, tid, body, actor, session.user_id, outbox)
        result = await core.full_tenant(conn, tid)
    await outbox.publish(d.bus)
    return JSONResponse(result)


async def patch_tenant(request: Request) -> Response:
    return await _registry_write(request, "patch")


async def post_status(request: Request) -> Response:
    return await _registry_write(request, "status")


async def read_audit(request: Request) -> Response:
    d = deps(request)
    await d.caller.superadmin(request)
    before, limit = audit.page_args(request.query_params)
    tid = request.query_params.get("tenant_id")
    platform = request.query_params.get("platform") == "true"
    if platform == (tid is not None):
        raise bad_request("give either tenant_id or platform=true")
    page: dict[str, Any]
    if tid is None:
        async with d.db.platform() as conn:
            page = await audit.read(conn, None, before, limit)
    else:
        async with d.db.tenant(model.check_tenant_id(tid)) as conn:
            page = await audit.read(conn, tid, before, limit)
    return JSONResponse(page)


# Deleting a tenant (`DELETE /api/tenants/registry/{tenant_id}`, #150) goes here. It must delete
# the event's `storage_counts` rows with the tenant (contracts/tenants.md, Storage quota, Clone and
# delete), once every module has deleted the event's files; the migration grants no DELETE yet.
ROUTES = [
    Route("/api/tenants/registry", list_tenants, methods=["GET"]),
    Route("/api/tenants/registry", create_tenant, methods=["POST"]),
    Route("/api/tenants/registry/{tenant_id}", get_tenant, methods=["GET"]),
    Route("/api/tenants/registry/{tenant_id}", patch_tenant, methods=["PATCH"]),
    Route("/api/tenants/registry/{tenant_id}/status", post_status, methods=["POST"]),
    Route("/api/tenants/audit", read_audit, methods=["GET"]),
]
