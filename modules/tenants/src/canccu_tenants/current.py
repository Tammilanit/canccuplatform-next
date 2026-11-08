"""The request's own event: `/api/tenants/current…` on a tenant's hostname."""

from __future__ import annotations

from datetime import timedelta

from canccu_kit import KitError
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import audit, core, model
from .caller import tenant_of
from .deps import deps
from .model import bad_request, body_of, conflict

IP_CHECK_MAX_OFF = timedelta(hours=48)


async def get_current(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    session = await d.caller.session(request)
    async with d.db.tenant() as conn:
        row = await core.tenant_row(conn, ctx["tenant_id"])
        primary = await core.primary_hostname(conn, ctx["tenant_id"])
    if await d.caller.can(ctx, session, "tenants.event.write"):
        return JSONResponse(model.tenant(row, primary, core.now()))
    if row["status"] == "draft":  # a guest learns only that it is not open yet
        return JSONResponse({"id": row["id"], "status": "draft"})
    return JSONResponse(model.public_tenant(row, primary))


async def patch_current(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    body = await body_of(request)
    needed = set()
    if set(body) & core.EVENT_FIELDS:
        needed.add("tenants.event.write")
    if set(body) & core.ACCESS_FIELDS:
        needed.add("tenants.access.write")
    session = await d.caller.require_all(request, needed or {"tenants.event.write"})
    user_id = session.user_id
    outbox = core.Outbox()
    async with d.db.tenant() as conn:
        actor = await audit.user_actor(conn, user_id)
        await core.patch_tenant(
            conn,
            ctx["tenant_id"],
            body,
            core.EVENT_FIELDS | core.ACCESS_FIELDS,
            actor,
            user_id,
            d.files,
            outbox,
        )
        result = await core.full_tenant(conn, ctx["tenant_id"])
    await outbox.publish(d.bus)
    return JSONResponse(result)


async def post_status(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    session = await d.caller.require(request, "tenants.lifecycle.write")
    body = await body_of(request)
    outbox = core.Outbox()
    async with d.db.tenant() as conn:
        actor = await audit.user_actor(conn, session.user_id)
        await core.change_status(conn, ctx["tenant_id"], body, actor, session.user_id, outbox)
        result = await core.full_tenant(conn, ctx["tenant_id"])
    await outbox.publish(d.bus)
    return JSONResponse(result)


async def get_flags(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    if ctx["status"] == "draft":
        session = await d.caller.session(request)
        if not await d.caller.can(ctx, session, "tenants.flags.write"):
            raise KitError("not open yet", status=403, code="info_pages_closed")
    async with d.db.tenant() as conn:
        row = await core.tenant_row(conn, ctx["tenant_id"])
        flags = await core.flags_of(conn, d.declared_flags)
    return JSONResponse({"flags_version": row["flags_version"], "flags": flags})


async def put_flags(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    session = await d.caller.require(request, "tenants.flags.write")
    body = await body_of(request)
    version = model.check_revision(body, "flags_version")
    flags = body.get("flags")
    if not isinstance(flags, dict) or not all(isinstance(v, bool) for v in flags.values()):
        raise bad_request("flags: an object of booleans")
    unknown = sorted(set(flags) - set(d.declared_flags))
    if unknown:
        raise KitError(f"undeclared flag(s): {', '.join(unknown)}", status=400, code="unknown_flag")
    tid = ctx["tenant_id"]
    async with d.db.tenant() as conn:
        row = await core.tenant_row(conn, tid, lock=True)
        core.writable(row)
        if row["flags_version"] != version:
            raise conflict("version_conflict", "the flags changed meanwhile; read them again")
        before = await core.flags_of(conn, d.declared_flags)
        changed = sorted(name for name, value in flags.items() if before[name] != value)
        for name in changed:
            await conn.execute(
                "INSERT INTO tenant_flags (name, value) VALUES ($1, $2)"
                " ON CONFLICT (tenant_id, name) DO UPDATE SET value = $2",
                name,
                flags[name],
            )
        new_version = row["flags_version"]
        if changed:
            new_version = await conn.fetchval(
                "UPDATE tenants SET flags_version = flags_version + 1 WHERE id = $1"
                " RETURNING flags_version",
                tid,
            )
            actor = await audit.user_actor(conn, session.user_id)
            await audit.append(
                conn,
                tid,
                actor,
                "tenants.flags.changed",
                {"type": "tenant", "id": tid},
                {n: {"old": before[n], "new": flags[n]} for n in changed},
            )
        after = await core.flags_of(conn, d.declared_flags)
    if changed:
        await d.bus.publish(
            "tenants.flags.changed",
            {
                "flags_version": new_version,
                "changed": changed,
                "flags": after,
                "actor_user_id": session.user_id,
            },
            version=1,
            tenant=tid,
        )
    return JSONResponse({"flags_version": new_version, "flags": after})


async def put_ip_check(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    session = await d.caller.require(request, "tenants.venue_ip_check.write")
    body = await body_of(request)
    now = core.now()
    if body.get("enabled") is True:
        until, reason = None, None
    elif body.get("enabled") is False:
        reason = body.get("reason")
        if not isinstance(reason, str) or not 1 <= len(reason) <= 500:
            raise bad_request("reason is required to turn the check off")
        until = model.parse_time(body.get("until"), "until")
        if until is None or not now < until <= now + IP_CHECK_MAX_OFF:
            raise bad_request("until must be in the future and at most 48 hours ahead")
    else:
        raise bad_request("enabled must be true or false")
    tid = ctx["tenant_id"]
    async with d.db.tenant() as conn:
        row = await core.tenant_row(conn, tid, lock=True)
        core.writable(row)
        await conn.execute(
            "UPDATE tenants SET ip_check_disabled_until = $2, ip_check_reason = $3,"
            " revision = revision + 1 WHERE id = $1",
            tid,
            until,
            reason,
        )
        actor = await audit.user_actor(conn, session.user_id)
        await audit.append(
            conn,
            tid,
            actor,
            "tenants.venue_ip_check.changed",
            {"type": "tenant", "id": tid},
            {"enabled": {"old": model.ip_check(row, now)["enabled"], "new": until is None}},
            reason,
        )
        result = await core.full_tenant(conn, tid)
    await d.bus.publish(
        "tenants.venue_ip_check.changed",
        {
            "enabled": until is None,
            "until": model.iso(until),
            "actor_user_id": session.user_id,
        },
        version=1,
        tenant=tid,
    )
    return JSONResponse(result["venue_ip_check"])


async def get_audit(request: Request) -> Response:
    d = deps(request)
    await d.caller.require(request, "tenants.audit.read")
    before, limit = audit.page_args(request.query_params)
    async with d.db.tenant() as conn:
        page = await audit.read(conn, tenant_of(request)["tenant_id"], before, limit)
    return JSONResponse(page)


ROUTES = [
    Route("/api/tenants/current", get_current, methods=["GET"]),
    Route("/api/tenants/current", patch_current, methods=["PATCH"]),
    Route("/api/tenants/current/status", post_status, methods=["POST"]),
    Route("/api/tenants/current/flags", get_flags, methods=["GET"]),
    Route("/api/tenants/current/flags", put_flags, methods=["PUT"]),
    Route("/api/tenants/current/venue-ip-check", put_ip_check, methods=["PUT"]),
    Route("/api/tenants/current/audit", get_audit, methods=["GET"]),
]
