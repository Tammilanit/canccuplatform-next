"""Venues: global rows the superadmin manages (contracts/tenants.md, Venues). Changing a venue never
changes an event's copy of its profile; events copy again themselves."""

from __future__ import annotations

import json
import secrets
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import audit, model
from .current import body_of
from .deps import deps
from .model import bad_request, conflict, not_found
from .venue_info import read_plan, write_file


async def _event(d: Any, venue_id: str, changed: list[str], deleted: bool = False) -> None:
    await d.bus.publish(
        "tenants.venue.changed",
        {
            "venue_id": venue_id,
            "changed": changed,
            "deleted": deleted,
        },
        version=1,
        platform=True,
    )


async def list_venues(request: Request) -> Response:
    d = deps(request)
    await d.caller.superadmin(request)
    async with d.db.platform() as conn:
        rows = await conn.fetch("SELECT * FROM venues ORDER BY name, id")
    return JSONResponse({"venues": [model.venue(r) for r in rows]})


async def create_venue(request: Request) -> Response:
    d = deps(request)
    session = await d.caller.superadmin(request)
    body = await body_of(request)
    name = model.check_name(body.get("name"))
    addresses = model.check_addresses(body.get("addresses"))
    profile = body.get("profile", {"house_rules": "", "wifi": []})
    if not isinstance(profile, dict):
        raise bad_request("profile must be an object")
    rules, wifi = model.check_profile(profile)
    venue_id = "v_" + secrets.token_hex(8)
    async with d.db.platform() as conn:
        row = await conn.fetchrow(
            "INSERT INTO venues (id, name, addresses, house_rules, wifi)"
            " VALUES ($1, $2, $3, $4, $5) RETURNING *",
            venue_id,
            name,
            addresses,
            rules,
            json.dumps(wifi),
        )
        actor = await audit.user_actor(conn, session.user_id)
        await audit.append(
            conn,
            None,
            actor,
            "tenants.venue.created",
            {"type": "venue", "id": venue_id},
            {"name": name, "addresses": addresses},
        )
    await _event(d, venue_id, ["name", "addresses", "profile"])
    return JSONResponse(model.venue(row), status_code=201)


async def _venue(conn: Any, venue_id: str, lock: bool = False) -> Any:
    row = await conn.fetchrow(
        "SELECT * FROM venues WHERE id = $1" + (" FOR UPDATE" if lock else ""), venue_id
    )
    if row is None:
        raise not_found()
    return row


async def get_venue(request: Request) -> Response:
    d = deps(request)
    await d.caller.superadmin(request)
    async with d.db.platform() as conn:
        row = await _venue(conn, request.path_params["venue_id"])
    return JSONResponse(model.venue(row))


async def patch_venue(request: Request) -> Response:
    d = deps(request)
    session = await d.caller.superadmin(request)
    body = await body_of(request)
    revision = model.check_revision(body)
    venue_id = request.path_params["venue_id"]
    values: dict[str, Any] = {}
    if "name" in body:
        values["name"] = model.check_name(body["name"])
    if "addresses" in body:
        values["addresses"] = model.check_addresses(body["addresses"])
    if "profile" in body:
        if not isinstance(body["profile"], dict):
            raise bad_request("profile must be an object")
        values["house_rules"], wifi = model.check_profile(body["profile"])
        values["wifi"] = json.dumps(wifi)
    async with d.db.platform() as conn:
        row = await _venue(conn, venue_id, lock=True)
        if row["revision"] != revision:
            raise conflict("version_conflict", "the venue changed meanwhile; read it again")
        if values:
            sets = ", ".join(f"{k} = ${i}" for i, k in enumerate(values, start=2))
            row = await conn.fetchrow(
                f"UPDATE venues SET {sets}, revision = revision + 1 WHERE id = $1 RETURNING *",
                venue_id,
                *values.values(),
            )
            actor = await audit.user_actor(conn, session.user_id)
            # Addresses are audited with values (they decide access); profile fields by name only.
            changes: dict[str, Any] = {"fields": sorted(values)}
            if "addresses" in values:
                changes["addresses"] = values["addresses"]
            await audit.append(
                conn,
                None,
                actor,
                "tenants.venue.changed",
                {"type": "venue", "id": venue_id},
                changes,
            )
    if values:
        changed = sorted({"house_rules": "profile", "wifi": "profile"}.get(k, k) for k in values)
        await _event(d, venue_id, sorted(set(changed)))
    return JSONResponse(model.venue(row))


async def delete_venue(request: Request) -> Response:
    d = deps(request)
    session = await d.caller.superadmin(request)
    venue_id = request.path_params["venue_id"]
    async with d.db.platform() as conn:
        await _venue(conn, venue_id, lock=True)
        if await conn.fetchval("SELECT 1 FROM tenants WHERE venue_id = $1 LIMIT 1", venue_id):
            raise conflict("venue_in_use", "an event points to this venue")
        await conn.execute("DELETE FROM venues WHERE id = $1", venue_id)
        actor = await audit.user_actor(conn, session.user_id)
        await audit.append(
            conn, None, actor, "tenants.venue.deleted", {"type": "venue", "id": venue_id}
        )
    d.files.venue_plan(venue_id).unlink(missing_ok=True)
    await _event(d, venue_id, [], deleted=True)
    return Response(status_code=204)


async def put_venue_plan(request: Request) -> Response:
    d = deps(request)
    session = await d.caller.superadmin(request)
    venue_id = request.path_params["venue_id"]
    data, kind = await read_plan(request)
    async with d.db.platform() as conn:
        await _venue(conn, venue_id, lock=True)
        row = await conn.fetchrow(
            "UPDATE venues SET floor_plan_type = $2, floor_plan_updated_at = now(),"
            " revision = revision + 1 WHERE id = $1 RETURNING *",
            venue_id,
            kind,
        )
        write_file(d.files.venue_plan(venue_id), data)
        actor = await audit.user_actor(conn, session.user_id)
        await audit.append(
            conn,
            None,
            actor,
            "tenants.venue.changed",
            {"type": "venue", "id": venue_id},
            {"fields": ["floor_plan"]},
        )
    await _event(d, venue_id, ["profile"])
    return JSONResponse(model.venue(row))


async def internal_venue(request: Request) -> Response:
    d = deps(request)
    async with d.db.platform() as conn:
        row = await _venue(conn, request.path_params["venue_id"])
    return JSONResponse(model.venue_ref(row))


ROUTES = [
    Route("/api/tenants/venues", list_venues, methods=["GET"]),
    Route("/api/tenants/venues", create_venue, methods=["POST"]),
    Route("/api/tenants/venues/{venue_id}", get_venue, methods=["GET"]),
    Route("/api/tenants/venues/{venue_id}", patch_venue, methods=["PATCH"]),
    Route("/api/tenants/venues/{venue_id}", delete_venue, methods=["DELETE"]),
    Route("/api/tenants/venues/{venue_id}/floor-plan", put_venue_plan, methods=["PUT"]),
]
