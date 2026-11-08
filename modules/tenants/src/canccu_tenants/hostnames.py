"""Hostnames (contracts/tenants.md, Hostnames): superadmin only, all on the platform stream."""

from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any

from canccu_kit.resolve import normalize_host
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import audit, core, model
from .deps import Deps, deps
from .model import bad_request, body_of, conflict, not_found

HOLD = timedelta(days=30)


def kind_of(d: Deps, host: str) -> str:
    """`platform` only for one label directly under the platform domain: the wildcard
    certificate covers exactly those."""
    domain = d.platform_domain
    if domain and host.endswith("." + domain) and "." not in host[: -len(domain) - 1]:
        return "platform"
    return "custom"


async def _audit(
    conn: Any, session_user: str, action: str, row: Any, changes: dict[str, Any]
) -> None:
    actor = await audit.user_actor(conn, session_user)
    await audit.append(
        conn,
        None,
        actor,
        action,
        {"type": "hostname", "id": row["hostname"]},
        {"tenant_id": row["tenant_id"], **changes},
    )


async def list_hostnames(request: Request) -> Response:
    d = deps(request)
    await d.caller.superadmin(request)
    tid = request.path_params["tenant_id"]
    async with d.db.platform() as conn:
        if not await conn.fetchval("SELECT 1 FROM tenants WHERE id = $1", tid):
            raise not_found()
        rows = await conn.fetch(
            "SELECT * FROM hostnames WHERE tenant_id = $1 ORDER BY hostname", tid
        )
    return JSONResponse({"hostnames": [model.hostname(r) for r in rows]})


async def add_hostname(request: Request) -> Response:
    d = deps(request)
    session = await d.caller.superadmin(request)
    body = await body_of(request)
    raw = body.get("hostname")
    host = normalize_host(raw if isinstance(raw, str) else None)
    if host is None or host != raw or not model.HOSTNAME_RE.fullmatch(host):
        raise bad_request("hostname: a fully qualified name, lowercase, no trailing dot")
    if host in d.reserved_hosts:
        raise conflict("hostname_reserved", "the platform's own hostnames cannot be registered")
    tid = request.path_params["tenant_id"]
    kind = kind_of(d, host)
    status = "active" if kind == "platform" else "pending"
    token = None if kind == "platform" else secrets.token_urlsafe(24)
    outbox = core.Outbox()
    async with d.db.platform() as conn:
        # Locking the tenant row serialises this tenant's hostname writes, so two adds cannot
        # both find no primary.
        if not await conn.fetchval("SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE", tid):
            raise not_found()
        existing = await conn.fetchrow(
            "SELECT * FROM hostnames WHERE hostname = $1 FOR UPDATE", host
        )
        if existing is not None and existing["status"] != "held":
            raise conflict("hostname_taken", "this hostname points to an event already")
        if existing is not None and existing["tenant_id"] != tid:
            raise conflict("hostname_held", "this hostname is held after its removal")
        # Only an active name may be primary: `primary_hostname` builds absolute URLs.
        primary = status == "active" and not await _has_primary(conn, tid)
        # The update only takes back this tenant's own held name; a name another request
        # inserted meanwhile (or another tenant's) returns no row.
        row = await conn.fetchrow(
            "INSERT INTO hostnames (hostname, tenant_id, kind, status, is_primary, verify_token)"
            " VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (hostname) DO UPDATE SET status = $4,"
            " kind = $3, is_primary = $5, verify_token = $6, held_until = NULL"
            " WHERE hostnames.status = 'held' AND hostnames.tenant_id = EXCLUDED.tenant_id"
            " RETURNING *",
            host,
            tid,
            kind,
            status,
            primary,
            token,
        )
        if row is None:
            raise conflict("hostname_taken", "this hostname points to an event already")
        await _audit(conn, session.user_id, "tenants.hostname.added", row, {"kind": kind})
        core.hostname_changed(outbox, row)
    await outbox.publish(d.bus)
    return JSONResponse(model.hostname(row), status_code=201)


async def _has_primary(conn: Any, tenant_id: str) -> bool:
    found = await conn.fetchval(
        "SELECT 1 FROM hostnames WHERE tenant_id = $1 AND is_primary", tenant_id
    )
    return found is not None


async def _lock_tenant_of(conn: Any, host: str) -> Any:
    """The tenant row first, then the hostname row: the same order as add_hostname, so
    concurrent hostname writes of one tenant queue instead of deadlocking."""
    tid = await conn.fetchval(
        "SELECT tenant_id FROM hostnames WHERE hostname = $1 AND status <> 'held'", host
    )
    if tid is not None:
        await conn.execute("SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE", tid)
    row = await conn.fetchrow(
        "SELECT * FROM hostnames WHERE hostname = $1 AND status <> 'held' FOR UPDATE", host
    )
    if row is None or row["tenant_id"] != tid:
        raise not_found()
    return row


async def _locked(conn: Any, request: Request) -> Any:
    return await _lock_tenant_of(conn, request.path_params["hostname"])


async def make_primary(request: Request) -> Response:
    d = deps(request)
    session = await d.caller.superadmin(request)
    body = await body_of(request)
    if body.get("primary") is not True:
        raise bad_request("primary must be true")
    outbox = core.Outbox()
    async with d.db.platform() as conn:
        row = await _locked(conn, request)
        if row["status"] != "active":
            raise conflict("hostname_not_active", "only an active hostname can be primary")
        await conn.execute(
            "UPDATE hostnames SET is_primary = false WHERE tenant_id = $1 AND is_primary",
            row["tenant_id"],
        )
        row = await conn.fetchrow(
            "UPDATE hostnames SET is_primary = true WHERE hostname = $1 RETURNING *",
            row["hostname"],
        )
        await _audit(conn, session.user_id, "tenants.hostname.changed", row, {"primary": True})
        core.hostname_changed(outbox, row)
    await outbox.publish(d.bus)
    return JSONResponse(model.hostname(row))


async def remove_hostname(request: Request) -> Response:
    d = deps(request)
    session = await d.caller.superadmin(request)
    outbox = core.Outbox()
    async with d.db.platform() as conn:
        row = await _locked(conn, request)
        held = await conn.fetchrow(
            "UPDATE hostnames SET status = 'held', is_primary = false, verify_token = NULL,"
            " held_until = now() + $2::interval WHERE hostname = $1 RETURNING *",
            row["hostname"],
            HOLD,
        )
        if row["is_primary"]:  # another active name takes over, so absolute URLs keep working
            await conn.execute(
                "UPDATE hostnames SET is_primary = true WHERE hostname = (SELECT hostname"
                " FROM hostnames WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at"
                " LIMIT 1)",
                row["tenant_id"],
            )
        await _audit(conn, session.user_id, "tenants.hostname.removed", held, {})
        core.hostname_changed(outbox, held)
    await outbox.publish(d.bus)
    return Response(status_code=204)


async def verify_hostname(request: Request) -> Response:
    d = deps(request)
    session = await d.caller.superadmin(request)
    host = request.path_params["hostname"]
    async with d.db.platform() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM hostnames WHERE hostname = $1 AND status <> 'held'", host
        )
    if row is None:
        raise not_found()
    if row["status"] == "active":
        return JSONResponse(model.hostname(row))
    # The DNS read runs outside any transaction: it may take seconds.
    values = await d.txt_lookup(f"_canccu-verify.{host}")
    if row["verify_token"] not in values:
        raise conflict("verification_failed", "the TXT record is missing or does not match")
    outbox = core.Outbox()
    async with d.db.platform() as conn:
        token = row["verify_token"]
        locked = await _lock_tenant_of(conn, host)
        if locked["status"] != "pending" or locked["verify_token"] != token:
            raise conflict("verification_failed", "the hostname changed meanwhile")
        # The first active name of a tenant becomes its primary, so absolute URLs work at once.
        row = await conn.fetchrow(
            "UPDATE hostnames SET status = 'active', verify_token = NULL, is_primary = $2"
            " WHERE hostname = $1 RETURNING *",
            host,
            not await _has_primary(conn, locked["tenant_id"]),
        )
        await _audit(conn, session.user_id, "tenants.hostname.verified", row, {})
        core.hostname_changed(outbox, row)
    await outbox.publish(d.bus)
    return JSONResponse(model.hostname(row))


ROUTES = [
    Route("/api/tenants/registry/{tenant_id}/hostnames", list_hostnames, methods=["GET"]),
    Route("/api/tenants/registry/{tenant_id}/hostnames", add_hostname, methods=["POST"]),
    Route("/api/tenants/hostnames/{hostname}", make_primary, methods=["PATCH"]),
    Route("/api/tenants/hostnames/{hostname}", remove_hostname, methods=["DELETE"]),
    Route("/api/tenants/hostnames/{hostname}/verify", verify_hostname, methods=["POST"]),
]
