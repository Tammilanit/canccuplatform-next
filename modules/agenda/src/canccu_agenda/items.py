"""Items: list, read, now and next, add, and edit or move (contracts/agenda.md, Reading and
Editing live). Delay, cancel and remove are in edits.py."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from canccu_kit import KitError
from canccu_kit.rights import Session
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import model, store, timers
from .access import viewer, writer
from .deps import Deps, deps
from .edits import target
from .effective import event_settings, read_channels
from .inverse import Inverse
from .kinds import body, not_found

# Fields an organiser may never change on an item a tournament session owns.
MANAGED_FIELDS = frozenset({"title", "kind", "starts_at", "ends_at"})
EDITABLE = (
    "title",
    "description",
    "kind",
    "starts_at",
    "ends_at",
    "location",
    "zone",
    "visibility",
    "reminder_leads_minutes",
    "notify",
)


async def render(conn: Any, rows: list[Any], channels: list[str]) -> list[dict[str, Any]]:
    kinds = await store.kinds(conn)
    return [model.item_json(row, kinds, channels) for row in rows]


def _flag(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    if value not in ("true", "false"):
        raise model.invalid("include_cancelled must be true or false")
    return value == "true"


async def list_items(request: Request) -> Response:
    seen = await viewer(request)
    q = request.query_params
    where: list[str] = []
    args: list[Any] = []
    if q.get("from") is not None:
        args.append(model.parse_time(q["from"], "from"))
        n = len(args) + 1
        # Half-open, like /now: an item that ended exactly at `from` is over.
        where.append(f"(ends_at > ${n} OR (ends_at IS NULL AND starts_at >= ${n}))")
    if q.get("to") is not None:
        args.append(model.parse_time(q["to"], "to"))
        where.append(f"starts_at < ${len(args) + 1}")
    if not _flag(q.get("include_cancelled"), True):
        where.append("status = 'scheduled'")
    d = deps(request)
    channels = await read_channels(d)
    async with d.db.tenant() as conn:
        state = await store.state(conn)
        rows = await store.items(
            conn, seen.visibilities, where=" AND ".join(where), args=tuple(args)
        )
        items = await render(conn, rows, channels)
    return JSONResponse({"agenda_version": state["agenda_version"], "items": items})


async def get_item(request: Request) -> Response:
    seen = await viewer(request)
    d = deps(request)
    channels = await read_channels(d)
    async with d.db.tenant() as conn:
        row = await store.item(conn, request.path_params["item_id"])
        # An item the caller may not see does not exist for them.
        if row is None or row["visibility"] not in seen.visibilities:
            raise not_found("item")
        (item,) = await render(conn, [row], channels)
    return JSONResponse(item)


async def now(request: Request) -> Response:
    """The scheduled items running now, and those with the earliest start after now."""
    seen = await viewer(request)
    body = await now_and_next(deps(request), seen.visibilities, request.query_params.get("zone"))
    return JSONResponse(body)


async def now_and_next(d: Deps, visibilities: frozenset[str], zone: str | None) -> dict[str, Any]:
    """One answer for the hub's read and the screens' module read, so they never disagree. Runs in
    the tenant scope of the caller."""
    at = d.now()
    where = "status = 'scheduled' AND (ends_at > $2 OR starts_at > $2)"
    args: list[Any] = [at]
    if zone is not None:
        args.append(model.zone(zone))
        where += " AND (zone = $3 OR zone IS NULL)"
    channels = await read_channels(d)
    async with d.db.tenant() as conn:
        state = await store.state(conn)
        rows = await store.items(conn, visibilities, where=where, args=tuple(args))
        items = await render(conn, rows, channels)
    # A moment in time (no end) is never running: it is next until it starts, then past.
    current = [i for i, r in zip(items, rows, strict=True) if _running(r, at)]
    upcoming = [(i, r) for i, r in zip(items, rows, strict=True) if r["starts_at"] > at]
    first = upcoming[0][1]["starts_at"] if upcoming else None
    return {
        "time": model.iso(at),
        "agenda_version": state["agenda_version"],
        "current": current,
        "next": [i for i, r in upcoming if r["starts_at"] == first],
    }


def _running(row: Any, at: datetime) -> bool:
    return bool(row["ends_at"] is not None and row["starts_at"] <= at < row["ends_at"])


def _check_times(kind: str, starts: datetime, ends: datetime | None) -> None:
    if ends is not None and ends <= starts:
        raise model.invalid("ends_at must be after starts_at")
    if kind == "quiet_hours" and ends is None:
        raise model.invalid("a quiet_hours item needs an ends_at")


async def _check_kind(conn: Any, key: str) -> None:
    if await store.kind(conn, key) is None:
        raise KitError(f"unknown kind {key}", status=400, code="unknown_kind")


async def add_item(request: Request) -> Response:
    session = await writer(request)
    item = await add(deps(request), session, await body(request))
    return JSONResponse(item, status_code=201)


async def add(
    d: Deps, session: Session, data: dict[str, Any], *, inverse: Inverse | None = None
) -> dict[str, Any]:
    """Adds an item from the fields of a request body; the pages call it with theirs, and an
    `inverse` to offer the undo."""
    starts = model.parse_time(data.get("starts_at"), "starts_at")
    ends_raw = data.get("ends_at")
    ends = None if ends_raw is None else model.parse_time(ends_raw, "ends_at")
    links = model.links(data.get("links"))
    values: dict[str, Any] = {
        "title": model.text(data.get("title"), "title", 120, required=True),
        "description": model.text(data.get("description"), "description", 2000),
        "kind": model.kind_key(data.get("kind")),
        "starts_at": starts,
        "ends_at": ends,
        "planned_starts_at": starts,
        "planned_ends_at": ends,
        "location": model.text(data.get("location"), "location", 120),
        "zone": model.zone(data.get("zone")),
        "visibility": model.visibility(data.get("visibility")),
        "reminder_leads_minutes": model.leads(data.get("reminder_leads_minutes")),
        "notify": model.channels(data.get("notify")),
        "tournament_id": links["tournament_id"],
        "moment_id": links["moment_id"],
    }
    _check_times(values["kind"], starts, ends)
    channels, leads = await event_settings(d)
    async with d.db.tenant() as conn:
        await store.state(conn, lock=True)
        await _check_kind(conn, values["kind"])
        row = await store.insert_item(conn, values, store.actor_of(session))
        if inverse is not None:
            inverse.remove(row)
        version = await store.bump(conn, "agenda_version")
        await timers.reschedule(conn, [row], await store.kinds(conn), leads, d.now())
        (item,) = await render(conn, [row], channels)
        await d.outbox.add(
            conn,
            "agenda.item.added",
            {"item": item, "agenda_version": version, "actor_user_id": session.user_id},
            version=1,
        )
    await d.outbox.flush()
    return item


def edit_values(data: dict[str, Any]) -> dict[str, Any]:
    """The validated fields of an edit; `null` clears or hands back to the kind."""
    out: dict[str, Any] = {}
    for key in EDITABLE:
        if key not in data:
            continue
        v = data[key]
        if key in ("title", "kind", "starts_at", "visibility") and v is None:
            raise model.invalid(f"{key} cannot be null")
        if key == "title":
            out[key] = model.text(v, key, 120, required=True)
        elif key in ("description", "location"):
            out[key] = model.text(v, key, 2000 if key == "description" else 120)
        elif key == "kind":
            out[key] = model.kind_key(v)
        elif key in ("starts_at", "ends_at"):
            out[key] = None if v is None else model.parse_time(v, key)
        elif key == "zone":
            out[key] = model.zone(v)
        elif key == "visibility":
            out[key] = model.visibility(v)
        elif key == "reminder_leads_minutes":
            out[key] = model.leads(v)
        else:
            out[key] = model.channels(v)
    return out


async def edit_item(request: Request) -> Response:
    session = await writer(request)
    data = await body(request)
    return JSONResponse(await edit(deps(request), session, request.path_params["item_id"], data))


async def edit(
    d: Deps,
    session: Session,
    item_id: str,
    data: dict[str, Any],
    *,
    inverse: Inverse | None = None,
) -> dict[str, Any]:
    """Edits or moves an item from the fields of a request body (`revision` included)."""
    sent_revision = model.revision(data.get("revision"))
    edits = edit_values(data)
    channels, leads = await event_settings(d)
    async with d.db.tenant() as conn:
        await store.state(conn, lock=True)
        row = await target(conn, item_id, sent_revision)
        if row["status"] == "cancelled":
            raise model.conflict("item_cancelled", "a cancelled item cannot be edited")
        changed = [k for k in edits if _differs(row, k, edits[k])]
        if row["managed_by"] is not None and MANAGED_FIELDS & set(changed):
            raise model.conflict("item_managed", "change this in the tournament module")
        if "kind" in changed:
            await _check_kind(conn, edits["kind"])
        values = {k: edits[k] for k in changed}
        # A move is a new plan: each given time becomes its planned value too.
        for key in ("starts_at", "ends_at"):
            if key in values:
                values[f"planned_{key}"] = values[key]
        _check_times(
            values.get("kind", row["kind"]),
            values.get("starts_at", row["starts_at"]),
            values.get("ends_at", row["ends_at"]),
        )
        if not values:
            (item,) = await render(conn, [row], channels)
            return item
        new_row = await store.update_item(conn, row, values, store.actor_of(session))
        if inverse is not None:
            inverse.restore(row, new_row, list(values))
        row = new_row
        version = await store.bump(conn, "agenda_version")
        await timers.reschedule(conn, [row], await store.kinds(conn), leads, d.now())
        (item,) = await render(conn, [row], channels)
        await d.outbox.add(
            conn,
            "agenda.item.changed",
            {
                "item": item,
                "changed": changed,
                "agenda_version": version,
                "actor_user_id": session.user_id,
            },
            version=1,
        )
    await d.outbox.flush()
    return item


def _differs(row: Any, key: str, value: Any) -> bool:
    current = row[key]
    if isinstance(current, list | tuple):
        current = list(current)
    if key in ("starts_at", "ends_at"):
        # Giving a delayed item its current time is still a move: it resets the delay.
        return bool(value != current or value != row[f"planned_{key}"])
    return bool(value != current)


ROUTES = [
    Route("/api/agenda/items", list_items, methods=["GET"]),
    Route("/api/agenda/items", add_item, methods=["POST"]),
    Route("/api/agenda/now", now, methods=["GET"]),
    Route("/api/agenda/items/{item_id}", get_item, methods=["GET"]),
    Route("/api/agenda/items/{item_id}", edit_item, methods=["PATCH"]),
]
