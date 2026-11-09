"""The tournament-session mirror (contracts/agenda.md, Tournament sessions; plan issue-187 D7).

Each `tournament.session.*` event becomes at most one change of the session's item, applied
only when `session.revision` is newer than the last one applied, and never after the session's
tombstone. The tournament module never writes the agenda; this consumer does it for it.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from canccu_kit import AdminUnavailable, Event, KitError

from . import model, store, timers
from .deps import Deps
from .edits import cancel, remove
from .effective import event_settings

log = logging.getLogger("canccu.agenda.mirror")

TYPES = (
    "tournament.session.added",
    "tournament.session.changed",
    "tournament.session.cancelled",
    "tournament.session.removed",
)
# The bus moves on after a failed handler, so a short admin outage must not drop a session.
SETTINGS_RETRIES = (1.0, 2.0, 4.0)

Published = list[tuple[str, dict[str, Any]]]


class Session:
    """The fields of the event catalog's Session the item takes; anything else is ignored."""

    def __init__(self, raw: Any) -> None:
        try:
            self.id = model.text(raw["id"], "session.id", 64, required=True) or ""
            self.revision = int(raw["revision"])
            self.tournament_id = model.text(raw["tournament_id"], "tournament_id", 64)
            name = model.text(raw["game"]["name"], "game.name", 200, required=True) or ""
            self.title = (f"{name} final" if raw["is_final"] is True else name)[:120]
            self.starts_at = model.parse_time(raw["starts_at"], "starts_at")
            ends = raw["ends_at"]
            self.ends_at = None if ends is None else model.parse_time(ends, "ends_at")
            self.status = str(raw["status"])
        except (KeyError, TypeError, ValueError, KitError) as exc:
            raise ValueError(f"not a session: {exc}") from None
        if self.ends_at is not None and self.ends_at <= self.starts_at:
            raise ValueError("the session ends before it starts")


async def handle(d: Deps, event: Event) -> None:
    """The bus handler, in the event's tenant scope."""
    if event.type not in TYPES:
        return
    actor = event.data.get("actor_user_id")
    try:
        if event.type == "tournament.session.removed":
            session_id = event.data["session_id"]
            if not isinstance(session_id, str) or not 0 < len(session_id) <= 64:
                raise ValueError("no session_id")
            session = None
        else:
            session = Session(event.data.get("session"))
            session_id = session.id
    except (KeyError, ValueError) as exc:
        log.warning("skipped a session event", extra={"event_id": event.id, "reason": str(exc)})
        return
    # A replay at start (main.py) is mostly old events: skip them before asking admin anything.
    async with d.db.tenant() as conn:
        if _stale(await _mark(conn, session_id, lock=False), session):
            return
    channels, leads = await _settings(d)
    async with d.db.tenant() as conn:
        await store.state(conn, lock=True)
        mark = await _mark(conn, session_id, lock=True)
        if _stale(mark, session):
            return
        await conn.execute(
            "INSERT INTO agenda_sessions (session_id, revision, removed) VALUES ($1, $2, $3)"
            " ON CONFLICT (tenant_id, session_id) DO UPDATE"
            " SET revision = EXCLUDED.revision, removed = EXCLUDED.removed",
            session_id,
            session.revision if session else (mark["revision"] if mark else 0),
            session is None,
        )
        row = await conn.fetchrow(
            f"SELECT {store.ITEM_COLUMNS} FROM agenda_items"
            " WHERE tournament_session_id = $1 FOR UPDATE",
            session_id,
        )
        out: Published = []
        if session is None:
            if row is not None:
                out.append(_removed(row, await remove(conn, row["id"])))
        else:
            await _apply(conn, d, event, session, row, channels, leads, out)
    for event_type, data in out:
        await d.bus.publish(event_type, {**data, "actor_user_id": actor}, version=1)


async def _mark(conn: Any, session_id: str, *, lock: bool) -> Any:
    suffix = " FOR UPDATE" if lock else ""
    return await conn.fetchrow(
        f"SELECT revision, removed FROM agenda_sessions WHERE session_id = $1{suffix}", session_id
    )


def _stale(mark: Any, session: Session | None) -> bool:
    """After the tombstone everything is; otherwise a revision not newer than the last applied
    (redelivered or late)."""
    if mark is None:
        return False
    return bool(mark["removed"] or (session is not None and session.revision <= mark["revision"]))


def _removed(row: Any, version: int) -> tuple[str, dict[str, Any]]:
    return "agenda.item.removed", {
        "item_id": row["id"],
        "visibility": row["visibility"],
        "agenda_version": version,
    }


async def _apply(
    conn: Any,
    d: Deps,
    event: Event,
    session: Session,
    row: Any,
    channels: list[str],
    leads: list[int],
    out: Published,
) -> None:
    scheduled = row is not None and row["status"] == "scheduled"
    if session.status == "cancelled":
        # Also from `.changed`: the session's status is what counts, whichever event carries it.
        if scheduled:
            item, version = await cancel(conn, row, channels, leads, d)
            out.append(("agenda.item.cancelled", {"item": item, "agenda_version": version}))
        return
    if event.type == "tournament.session.cancelled":
        # Ended early: its end becomes the event's time, so nobody is told a played session
        # was cancelled.
        if scheduled:
            ended = model.parse_time(event.time, "time")
            if row["starts_at"] < ended != row["ends_at"]:
                await _move(conn, d, row, {"ends_at": ended}, channels, leads, out)
        return
    if row is not None and not scheduled:
        # Reopened: a new item, and the cancelled one goes, so the session has one item.
        out.append(_removed(row, await remove(conn, row["id"])))
        row = None
    if row is None:
        kinds = await store.kinds(conn)
        new = await store.insert_item(
            conn,
            {
                "title": session.title,
                "kind": "tournament" if "tournament" in kinds else "other",
                "starts_at": session.starts_at,
                "ends_at": session.ends_at,
                "planned_starts_at": session.starts_at,
                "planned_ends_at": session.ends_at,
                "visibility": "public",
                "tournament_id": session.tournament_id,
                "tournament_session_id": session.id,
                "managed_by": "tournament",
            },
        )
        version = await store.bump(conn, "agenda_version")
        await timers.reschedule(conn, [new], kinds, leads, d.now())
        item = model.item_json(new, kinds, channels)
        out.append(("agenda.item.added", {"item": item, "agenda_version": version}))
        return
    values: dict[str, Any] = {}
    if session.title != row["title"]:
        values["title"] = session.title
    # Equal times change nothing, so a session that only followed the agenda's own delay keeps
    # the item's planned times and its delay.
    if session.starts_at != row["starts_at"]:
        values["starts_at"] = session.starts_at
    if session.ends_at != row["ends_at"]:
        values["ends_at"] = session.ends_at
    if values:
        await _move(conn, d, row, values, channels, leads, out)


async def _move(
    conn: Any,
    d: Deps,
    row: Any,
    values: dict[str, Any],
    channels: list[str],
    leads: list[int],
    out: Published,
) -> None:
    """A move, as under Editing live: each given time becomes its planned value too."""
    changed = list(values)
    for key in ("starts_at", "ends_at"):
        if key in values:
            values[f"planned_{key}"] = values[key]
    starts: datetime = values.get("starts_at", row["starts_at"])
    ends: datetime | None = values.get("ends_at", row["ends_at"])
    if ends is not None and ends <= starts:
        log.warning("skipped a session move that ends before it starts", extra={"item": row["id"]})
        return
    new = await store.update_item(conn, row["id"], values)
    version = await store.bump(conn, "agenda_version")
    kinds = await store.kinds(conn)
    await timers.reschedule(conn, [new], kinds, leads, d.now())
    item = model.item_json(new, kinds, channels)
    out.append(
        ("agenda.item.changed", {"item": item, "changed": changed, "agenda_version": version})
    )


async def _settings(d: Deps) -> tuple[list[str], list[int]]:
    for pause in SETTINGS_RETRIES:
        try:
            return await event_settings(d)
        except AdminUnavailable:
            await wait(pause)
    return await event_settings(d)


async def wait(seconds: float) -> None:
    await asyncio.sleep(seconds)
