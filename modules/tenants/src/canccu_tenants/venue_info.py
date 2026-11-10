"""The event's copy of its venue's profile (contracts/tenants.md, Venue profile, copied into each
event), and the floor-plan upload shared with the superadmin's venues."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from canccu_kit import KitError, check_info_access
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import audit, core, model
from .caller import client_ip, tenant_of
from .deps import deps
from .model import body_of, conflict, not_found

MAX_PLAN = 10 * 1024 * 1024
# Checked by content, never by the client's Content-Type: SVG and HTML must never be stored.
MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)


def sniff(data: bytes) -> str | None:
    for magic, kind in MAGIC:
        if data.startswith(magic):
            return kind
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def read_plan(request: Request) -> tuple[bytes, str]:
    size = int(request.headers.get("content-length") or 0)
    if size > MAX_PLAN:
        raise KitError("at most 10 MB", status=413, code="file_too_large")
    buffer = bytearray()
    async for chunk in request.stream():
        buffer += chunk
        if len(buffer) > MAX_PLAN:
            raise KitError("at most 10 MB", status=413, code="file_too_large")
    data = bytes(buffer)
    kind = sniff(data)
    if kind is None:
        raise KitError("PNG, JPEG or WebP only", status=415, code="unsupported_type")
    return data, kind


def serve_plan(path: Path, kind: str) -> Response:
    # Served as data: no sniffing, no scripts, a download-safe disposition (0013 item 21).
    return Response(
        path.read_bytes(),
        media_type=kind,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Content-Disposition": "inline; filename=floor-plan",
        },
    )


async def _viewer(request: Request) -> str:
    d, ctx = deps(request), tenant_of(request)
    session = await d.caller.session(request)
    return "member" if await d.caller.is_member(ctx, session) else "guest"


def _info(row: Any, viewer: str) -> dict[str, Any]:
    wifi = model.wifi_of(row)
    if viewer == "guest":  # attendee networks, and so their passwords, stay hidden from guests
        wifi = [w for w in wifi if w["visibility"] == "public"]
    return {
        "venue_id": row["venue_id"],
        "copied_at": model.iso(row["copied_at"]),
        "house_rules": row["house_rules"],
        "wifi": wifi,
        "floor_plan": model.floor_plan(row),
        "revision": row["revision"],
    }


EMPTY = {
    "venue_id": None,
    "copied_at": None,
    "house_rules": "",
    "wifi": "[]",
    "floor_plan_type": None,
    "floor_plan_updated_at": None,
    "revision": 0,
}


async def get_info(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    viewer = await _viewer(request)
    check_info_access(ctx, client_ip=client_ip(request), viewer=viewer)  # type: ignore[arg-type]
    async with d.db.tenant() as conn:
        row = await conn.fetchrow("SELECT * FROM venue_info")
    return JSONResponse(_info(row or EMPTY, viewer))


async def put_info(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    session = await d.caller.require(request, "tenants.venue_info.write")
    body = await body_of(request)
    revision = model.check_revision(body)
    rules, wifi = model.check_profile(body)
    tid = ctx["tenant_id"]
    async with d.db.tenant() as conn:
        core.writable(await core.tenant_row(conn, tid))
        # A row to lock even on the first write, so concurrent first writes cannot both pass
        # the revision check.
        await conn.execute("INSERT INTO venue_info DEFAULT VALUES ON CONFLICT DO NOTHING")
        row = await conn.fetchrow("SELECT * FROM venue_info FOR UPDATE")
        if row["revision"] != revision:
            raise conflict("version_conflict", "the venue info changed meanwhile; read it again")
        changed = [
            k
            for k, v in (("house_rules", rules), ("wifi", wifi))
            if v != (model.wifi_of(row) if k == "wifi" else row[k])
        ]
        if changed:
            await conn.execute(
                "UPDATE venue_info SET house_rules = $1, wifi = $2, revision = revision + 1",
                rules,
                json.dumps(wifi),
            )
            actor = await audit.user_actor(conn, session.user_id)
            # Field names only: a Wi-Fi password is never written to the audit log.
            await audit.append(
                conn,
                tid,
                actor,
                "tenants.venue_info.changed",
                {"type": "venue_info", "id": tid},
                {"fields": changed},
            )
        result = await conn.fetchrow("SELECT * FROM venue_info")
    if changed:
        await d.bus.publish(
            "tenants.venue_info.changed",
            {"changed": changed, "copied": False, "actor_user_id": session.user_id},
            version=1,
            tenant=tid,
        )
    return JSONResponse(_info(result, "member"))


async def copy_info(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    session = await d.caller.require(request, "tenants.venue_info.write")
    tid = ctx["tenant_id"]
    outbox = core.Outbox()
    async with d.db.tenant() as conn:
        row = await core.tenant_row(conn, tid)
        core.writable(row)
        if row["venue_id"] is None:
            raise conflict("no_venue", "this event has no venue to copy from")
        actor = await audit.user_actor(conn, session.user_id)
        changed = await core.copy_venue_in(conn, tid, row["venue_id"], d.files, actor, outbox)
        result = await conn.fetchrow("SELECT * FROM venue_info")
    outbox.tenant(
        tid,
        "tenants.venue_info.changed",
        {"changed": changed, "copied": True, "actor_user_id": session.user_id},
    )
    await outbox.publish(d.bus)
    return JSONResponse(_info(result, "member"))


async def get_plan(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    viewer = await _viewer(request)
    check_info_access(ctx, client_ip=client_ip(request), viewer=viewer)  # type: ignore[arg-type]
    async with d.db.tenant() as conn:
        kind = await conn.fetchval("SELECT floor_plan_type FROM venue_info")
    path = d.files.tenant_plan(ctx["tenant_id"])
    if kind is None or not path.exists():
        raise not_found()
    return serve_plan(path, kind)


async def put_plan(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    session = await d.caller.require(request, "tenants.venue_info.write")
    data, kind = await read_plan(request)
    tid = ctx["tenant_id"]
    outbox = core.Outbox()
    async with d.db.tenant() as conn:
        core.writable(await core.tenant_row(conn, tid))
        await conn.execute(
            "INSERT INTO venue_info (floor_plan_type, floor_plan_updated_at, revision)"
            " VALUES ($1, now(), 1) ON CONFLICT (tenant_id) DO UPDATE SET floor_plan_type = $1,"
            " floor_plan_updated_at = now(), revision = venue_info.revision + 1",
            kind,
        )
        actor = await audit.user_actor(conn, session.user_id)
        await audit.append(
            conn,
            tid,
            actor,
            "tenants.venue_info.changed",
            {"type": "venue_info", "id": tid},
            {"fields": ["floor_plan"]},
        )
        result = await conn.fetchrow("SELECT * FROM venue_info")
    outbox.after_commit(lambda: core.write_file(d.files.tenant_plan(tid), data))
    outbox.tenant(
        tid,
        "tenants.venue_info.changed",
        {"changed": ["floor_plan"], "copied": False, "actor_user_id": session.user_id},
    )
    await outbox.publish(d.bus)
    return JSONResponse(_info(result, "member"))


ROUTES = [
    Route("/api/tenants/current/venue-info", get_info, methods=["GET"]),
    Route("/api/tenants/current/venue-info", put_info, methods=["PUT"]),
    Route("/api/tenants/current/venue-info/copy", copy_info, methods=["POST"]),
    Route("/api/tenants/current/venue-info/floor-plan", get_plan, methods=["GET"]),
    Route("/api/tenants/current/venue-info/floor-plan", put_plan, methods=["PUT"]),
]
