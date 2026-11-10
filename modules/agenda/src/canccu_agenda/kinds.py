"""The event's kind list: GET, PUT and DELETE /api/agenda/kinds (contracts/agenda.md, Kinds)."""

from __future__ import annotations

from typing import Any

from canccu_kit import KitError
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import model, store, timers
from .access import viewer, writer
from .deps import deps
from .effective import event_leads


async def body(request: Request) -> dict[str, Any]:
    try:
        value = await request.json()
    except ValueError:
        raise model.invalid("the body must be a JSON object") from None
    if not isinstance(value, dict):
        raise model.invalid("the body must be a JSON object")
    return value


def not_found(what: str) -> KitError:
    return KitError(f"{what} not found", status=404, code="not_found")


async def list_kinds(request: Request) -> Response:
    await viewer(request)
    async with deps(request).db.tenant() as conn:
        state = await store.state(conn)
        kinds = await store.kinds(conn)
    return JSONResponse(
        {
            "kinds_version": state["kinds_version"],
            "kinds": [model.kind_json(row) for row in kinds.values()],
        }
    )


async def save_kind(request: Request) -> Response:
    session = await writer(request)
    key = model.kind_key(request.path_params["kind_key"])
    data = await body(request)
    values = {
        "name": model.text(data.get("name"), "name", 60, required=True),
        "reminder_leads_minutes": model.leads(data.get("reminder_leads_minutes")),
        "notify": model.channels(data.get("notify")),
    }
    sent_revision = None if data.get("revision") is None else model.revision(data["revision"])
    d = deps(request)
    leads = await event_leads(d)
    async with d.db.tenant() as conn:
        await store.state(conn, lock=True)
        current = await store.kind(conn, key)
        if current is not None and sent_revision is None:
            raise model.conflict("kind_exists", f"the kind {key} exists: send its revision")
        # A revision for a kind that is gone is stale too: someone removed it meanwhile.
        if sent_revision is not None and (current is None or current["revision"] != sent_revision):
            raise model.conflict("version_conflict", "the kind changed: read it again")
        row = await store.save_kind(conn, key, values, exists=current is not None)
        kinds_version = await store.bump(conn, "kinds_version")
        # Its items' lead times in effect may have changed with it.
        items = await conn.fetch(
            f"SELECT {store.ITEM_COLUMNS} FROM agenda_items"
            " WHERE kind = $1 AND status = 'scheduled'",
            key,
        )
        await timers.reschedule(conn, items, await store.kinds(conn), leads, d.now())
        kind = model.kind_json(row)
        await d.outbox.add(
            conn,
            "agenda.kind.saved",
            {"kind": kind, "kinds_version": kinds_version, "actor_user_id": session.user_id},
            version=1,
        )
    await d.outbox.flush()
    return JSONResponse(kind, status_code=200 if current is not None else 201)


async def remove_kind(request: Request) -> Response:
    session = await writer(request)
    key = request.path_params["kind_key"]
    sent_revision = model.revision(int_query(request.query_params.get("revision")))
    d = deps(request)
    async with d.db.tenant() as conn:
        await store.state(conn, lock=True)
        current = await store.kind(conn, key)
        if current is None:
            raise not_found("kind")
        if key == "other":
            raise model.conflict("kind_required", "other is the fallback every consumer knows")
        if current["revision"] != sent_revision:
            raise model.conflict("version_conflict", "the kind changed: read it again")
        if await store.kind_in_use(conn, key):
            raise model.conflict("kind_in_use", "items still name this kind: move them first")
        await conn.execute("DELETE FROM agenda_kinds WHERE key = $1", key)
        kinds_version = await store.bump(conn, "kinds_version")
        await d.outbox.add(
            conn,
            "agenda.kind.removed",
            {"kind_key": key, "kinds_version": kinds_version, "actor_user_id": session.user_id},
            version=1,
        )
    await d.outbox.flush()
    return Response(status_code=204)


def int_query(value: str | None) -> int | None:
    try:
        return None if value is None else int(value)
    except ValueError:
        return None


ROUTES = [
    Route("/api/agenda/kinds", list_kinds, methods=["GET"]),
    Route("/api/agenda/kinds/{kind_key}", save_kind, methods=["PUT"]),
    Route("/api/agenda/kinds/{kind_key}", remove_kind, methods=["DELETE"]),
]
