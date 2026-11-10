"""The storage quota (contracts/tenants.md, Storage quota): one count of bytes per module of each
event, checked against the event's `storage_quota_bytes`. The modules keep the files; this module
only keeps the counts, so one event cannot fill the disk of the others."""

from __future__ import annotations

import re
from typing import Any

from canccu_kit import KitError, ServiceForbidden
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import core, model
from .caller import tenant_of
from .deps import deps
from .model import bad_request, body_of, not_found

MODULE_RE = re.compile(r"[a-z][a-z0-9_]{1,31}")
MAX_BYTES = 1_099_511_627_776
SHARED_STORAGE: dict[str, str] = {}
"""Service → the module whose files it writes and counts for. Empty: every writer today (screen,
theming) counts under its own name, and the render job never calls (it has no network)."""


def _check_owner(request: Request, module: str) -> None:
    # The service identity names the caller, as for audit appends: a module counts only its own
    # files, so one module cannot release another's bytes and let the event pass its quota.
    service: str = request.state.service
    if module != SHARED_STORAGE.get(service, service):
        raise ServiceForbidden(f"module {service} counts only its own files")


def _change(body: dict[str, Any]) -> tuple[str, int]:
    if set(body) - {"module", "bytes"}:
        raise bad_request("only module and bytes")
    module, size = body.get("module"), body.get("bytes")
    if not isinstance(module, str) or not MODULE_RE.fullmatch(module):
        raise bad_request("module: lowercase letters, digits and _, 2-32 characters, from a letter")
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= MAX_BYTES:
        raise bad_request(f"bytes: a whole number from 1 to {MAX_BYTES}")
    return module, size


def _tenant_query(request: Request) -> str:
    # Set by the calling module's kit from its own request's tenant, never from a client.
    return model.check_tenant_id(request.query_params.get("tenant_id"))


async def usage(conn: Any, quota: int) -> dict[str, Any]:
    """`StorageUsage`. Needs `conn` in the tenant's transaction: RLS shows only its counts."""
    rows = await conn.fetch(
        "SELECT module, bytes FROM storage_counts WHERE bytes > 0 ORDER BY module"
    )
    modules = {r["module"]: r["bytes"] for r in rows}
    return {"quota_bytes": quota, "used_bytes": sum(modules.values()), "modules": modules}


async def _quota(conn: Any, tid: str, *, lock: bool = False) -> Any:
    row = await conn.fetchrow(
        "SELECT status, storage_quota_bytes FROM tenants WHERE id = $1"
        + (" FOR UPDATE" if lock else ""),
        tid,
    )
    if row is None:
        raise not_found()
    return row


async def reserve(request: Request) -> Response:
    d, tid = deps(request), _tenant_query(request)
    module, size = _change(await body_of(request))
    _check_owner(request, module)
    async with d.db.tenant(tid) as conn:
        # The registry row's lock queues every reserve of the event, so the check below and the
        # add are one step: two uploads at once never both pass the quota.
        row = await _quota(conn, tid, lock=True)
        core.writable(row)
        quota, used = row["storage_quota_bytes"], (await usage(conn, 0))["used_bytes"]
        if used + size > quota:
            raise KitError(
                f"the event's files would pass its storage quota: {used} of {quota} bytes"
                f" used, {size} more asked",
                status=413,
                code="storage_quota_exceeded",
            )
        await conn.execute(
            "INSERT INTO storage_counts (module, bytes) VALUES ($1, $2) ON CONFLICT"
            " (tenant_id, module) DO UPDATE SET bytes = storage_counts.bytes + EXCLUDED.bytes",
            module,
            size,
        )
        return JSONResponse(await usage(conn, quota))


async def release(request: Request) -> Response:
    """Every status, also archived: retention deletes files there."""
    d, tid = deps(request), _tenant_query(request)
    module, size = _change(await body_of(request))
    _check_owner(request, module)
    async with d.db.tenant(tid) as conn:
        row = await _quota(conn, tid)
        await conn.execute(
            "UPDATE storage_counts SET bytes = GREATEST(bytes - $2, 0) WHERE module = $1",
            module,
            size,
        )
        return JSONResponse(await usage(conn, row["storage_quota_bytes"]))


async def get_storage(request: Request) -> Response:
    d, ctx = deps(request), tenant_of(request)
    await d.caller.require_member(request)
    async with d.db.tenant() as conn:
        row = await _quota(conn, ctx["tenant_id"])
        return JSONResponse(await usage(conn, row["storage_quota_bytes"]))


INTERNAL_ROUTES = [
    Route("/internal/tenants/storage/reserve", reserve, methods=["POST"]),
    Route("/internal/tenants/storage/release", release, methods=["POST"]),
]
ROUTES = [Route("/api/tenants/current/storage", get_storage, methods=["GET"])]
