"""Delay (with following), cancel and remove (contracts/agenda.md, Editing live; plan
issue-187 D5)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from canccu_kit import new_id
from canccu_kit.rights import Session
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import model, store, timers
from .access import writer
from .deps import Deps, deps
from .effective import event_settings
from .kinds import body, int_query, not_found


async def target(conn: Any, item_id: str, sent_revision: int) -> Any:
    """The item locked for a write, at the revision the caller read."""
    row = await store.item(conn, item_id, lock=True)
    if row is None:
        raise not_found("item")
    if row["revision"] != sent_revision:
        raise model.conflict("version_conflict", "the item changed: read it again")
    return row


def minutes_of(value: Any) -> int:
    if type(value) is not int or value == 0 or not -720 <= value <= 720:
        raise model.invalid("minutes must be a whole number from -720 to 720, not 0")
    return value


def _shifted(row: Any, shift: timedelta, now: datetime) -> tuple[datetime, datetime | None]:
    """The new times; an item already running keeps its start and only its end moves."""
    ends = row["ends_at"]
    if row["starts_at"] <= now:
        return row["starts_at"], None if ends is None else ends + shift
    return row["starts_at"] + shift, None if ends is None else ends + shift


@dataclass
class DelayPlan:
    """What a delay will do: the items that move (row, new start, new end), in order of the new
    start, and the items it leaves where they are, with the reason."""

    moves: list[tuple[Any, datetime, datetime | None]] = field(default_factory=list)
    kept: list[tuple[Any, str]] = field(default_factory=list)


async def plan_delay(
    conn: Any, row: Any, minutes: int, following: bool, now: datetime, *, lock: bool = True
) -> DelayPlan:
    """The one computation behind both the delay and its preview (plan issue-187 D10), so the
    preview can never disagree with what the change does. Checks every shifted item first."""
    if row["status"] == "cancelled":
        raise model.conflict("item_cancelled", "a cancelled item cannot be delayed")
    if row["starts_at"] <= now and row["ends_at"] is None:
        raise model.conflict("item_started", "the item has started and has no end to move")
    plan = DelayPlan()
    rows = [row]
    if following:
        later = await conn.fetch(
            f"SELECT {store.ITEM_COLUMNS} FROM agenda_items WHERE status = 'scheduled'"
            " AND starts_at >= $1 AND id <> $2"
            f" ORDER BY starts_at, id{' FOR UPDATE' if lock else ''}",
            row["starts_at"],
            row["id"],
        )
        for r in later:
            if r["kind"] == "quiet_hours":
                plan.kept.append((r, "quiet hours never move with a delay"))
            else:
                rows.append(r)
    shift = timedelta(minutes=minutes)
    for r in rows:
        if r is not row and r["starts_at"] <= now and (r["ends_at"] or now) <= now:
            plan.kept.append((r, "already over"))
            continue
        starts, ends = _shifted(r, shift, now)
        if ends is not None and ends <= starts:
            raise model.invalid(f"the shift would end {r['title']!r} before it starts")
        plan.moves.append((r, starts, ends))
    plan.moves.sort(key=lambda m: (m[1], m[0]["id"]))
    return plan


async def delay_item(request: Request) -> Response:
    session = await writer(request)
    data = await body(request)
    sent_revision = model.revision(data.get("revision"))
    minutes = minutes_of(data.get("minutes"))
    following = data.get("following", False)
    if not isinstance(following, bool):
        raise model.invalid("following must be true or false")
    item_id = request.path_params["item_id"]
    version, items = await delay(deps(request), session, item_id, sent_revision, minutes, following)
    return JSONResponse({"agenda_version": version, "items": items})


async def delay(
    d: Deps,
    session: Session,
    item_id: str,
    sent_revision: int,
    minutes: int,
    following: bool,
    *,
    expected_version: int | None = None,
) -> tuple[int, list[dict[str, Any]]]:
    """Applies a delay; answers the last `agenda_version` and the shifted items, the delayed
    item first. With `expected_version` (a page's preview), any change of the agenda since is
    409 `agenda_changed`, checked under the event's write lock."""
    minutes = minutes_of(minutes)
    channels, leads = await event_settings(d)
    now = d.now()
    async with d.db.tenant() as conn:
        state = await store.state(conn, lock=True)
        if expected_version is not None and state["agenda_version"] != expected_version:
            raise model.conflict("agenda_changed", "the run of show changed: preview again")
        row = await target(conn, item_id, sent_revision)
        plan = await plan_delay(conn, row, minutes, following, now)
        # Every item was checked before any is written, so a refused shift moves nothing.
        updated = []
        for r, starts, ends in plan.moves:
            new_row = await store.update_item(conn, r["id"], {"starts_at": starts, "ends_at": ends})
            updated.append((new_row, await store.bump(conn, "agenda_version")))
        kinds = await store.kinds(conn)
        await timers.reschedule(conn, [r for r, _ in updated], kinds, leads, now)
        shifted = [(model.item_json(r, kinds, channels), v) for r, v in updated]
    # One correlation id, in order of the new start: a consumer that takes the first of a
    # correlation id gets the earliest.
    correlation_id = new_id()
    for item, version in shifted:
        await d.bus.publish(
            "agenda.item.delayed",
            {
                "item": item,
                "minutes": minutes,
                "agenda_version": version,
                "actor_user_id": session.user_id,
            },
            version=1,
            correlation_id=correlation_id,
        )
    items = sorted((i for i, _ in shifted), key=lambda i: i["id"] != row["id"])
    return shifted[-1][1], items


async def cancel_item(request: Request) -> Response:
    session = await writer(request)
    data = await body(request)
    sent_revision = model.revision(data.get("revision"))
    item_id = request.path_params["item_id"]
    return JSONResponse(await cancel_one(deps(request), session, item_id, sent_revision))


async def cancel_one(d: Deps, session: Session, item_id: str, sent_revision: int) -> dict[str, Any]:
    channels, leads = await event_settings(d)
    async with d.db.tenant() as conn:
        await store.state(conn, lock=True)
        row = await target(conn, item_id, sent_revision)
        if row["managed_by"] is not None:
            raise model.conflict("item_managed", "cancel the session in the tournament module")
        if row["status"] == "cancelled":
            raise model.conflict("item_cancelled", "the item is already cancelled")
        item, version = await cancel(conn, row, channels, leads, d)
    await d.bus.publish(
        "agenda.item.cancelled",
        {"item": item, "agenda_version": version, "actor_user_id": session.user_id},
        version=1,
    )
    return item


async def cancel(
    conn: Any, row: Any, channels: list[str], leads: list[int], d: Deps
) -> tuple[dict[str, Any], int]:
    """Cancels inside the caller's transaction; dropping its timers means an item cancelled while
    it runs never emits `agenda.item.ended`."""
    row = await store.update_item(conn, row["id"], {"status": "cancelled"})
    version = await store.bump(conn, "agenda_version")
    kinds = await store.kinds(conn)
    await timers.reschedule(conn, [row], kinds, leads, d.now())
    return model.item_json(row, kinds, channels), version


async def remove_item(request: Request) -> Response:
    session = await writer(request)
    sent_revision = model.revision(int_query(request.query_params.get("revision")))
    d = deps(request)
    async with d.db.tenant() as conn:
        await store.state(conn, lock=True)
        row = await target(conn, request.path_params["item_id"], sent_revision)
        if row["managed_by"] is not None:
            raise model.conflict("item_managed", "remove the session in the tournament module")
        version = await remove(conn, row["id"])
    await d.bus.publish(
        "agenda.item.removed",
        {
            "item_id": row["id"],
            "visibility": row["visibility"],
            "agenda_version": version,
            "actor_user_id": session.user_id,
        },
        version=1,
    )
    return Response(status_code=204)


async def remove(conn: Any, item_id: str) -> int:
    """Removes inside the caller's transaction; its timers go with it (ON DELETE CASCADE)."""
    await conn.execute("DELETE FROM agenda_items WHERE id = $1", item_id)
    return await store.bump(conn, "agenda_version")


ROUTES = [
    Route("/api/agenda/items/{item_id}", remove_item, methods=["DELETE"]),
    Route("/api/agenda/items/{item_id}/delay", delay_item, methods=["POST"]),
    Route("/api/agenda/items/{item_id}/cancel", cancel_item, methods=["POST"]),
]
