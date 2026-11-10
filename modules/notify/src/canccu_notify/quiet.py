"""Quiet hours: the event's `quiet_hours` items in the run-of-show, and only those
(contracts/notify.md, Delivery rules; plan D8).

Notify keeps a mirror of them, fed by the agenda's item events and read again in full from
`GET /internal/agenda/items` on start-up, on `agenda.items.cloned` and when `agenda_version`
jumps. An agenda that cannot answer leaves the last mirror in place. The sender asks `active` for
every batch and `release`s what was held once they are over, so nothing depends on a timer in
one container.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from canccu_kit import Event, tenant_scope

from .deps import Deps
from .engine import parse_time

log = logging.getLogger("canccu_notify.quiet")
KIND = "quiet_hours"
ITEM_EVENTS = frozenset(
    {"agenda.item.added", "agenda.item.changed", "agenda.item.delayed", "agenda.item.cancelled"}
)
REMOVED, CLONED = "agenda.item.removed", "agenda.items.cloned"
LOCK = "hashtext('notify:quiet:' || current_setting('canccu.tenant'))"


def _row(item: Any) -> tuple[str, str, str, datetime, datetime] | None:
    """The mirror's row for an item, or None when it is no quiet hours."""
    if not isinstance(item, dict) or item.get("kind") != KIND:
        return None
    starts, ends = parse_time(item.get("starts_at")), parse_time(item.get("ends_at"))
    fields = (item.get("id"), item.get("visibility"), item.get("status"))
    if starts is None or ends is None or not all(isinstance(f, str) for f in fields):
        return None
    return (str(item["id"]), str(item["visibility"]), str(item["status"]), starts, ends)


async def _upsert(conn: Any, row: tuple[str, str, str, datetime, datetime]) -> None:
    await conn.execute(
        "INSERT INTO notify_quiet_hours (item_id, visibility, status, starts_at, ends_at)"
        " VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, item_id) DO UPDATE"
        " SET visibility = $2, status = $3, starts_at = $4, ends_at = $5",
        *row,
    )


async def _version(conn: Any) -> int | None:
    value: int | None = await conn.fetchval("SELECT agenda_version FROM notify_source_state")
    return value


async def _mirrored(conn: Any, version: int | None) -> None:
    await conn.execute(
        "INSERT INTO notify_source_state (agenda_version) VALUES ($1)"
        " ON CONFLICT (tenant_id) DO UPDATE SET agenda_version = $1",
        version,
    )
    await conn.execute(
        "INSERT INTO notify_agenda_tenants (tenant_id)"
        " VALUES (current_setting('canccu.tenant')) ON CONFLICT DO NOTHING"
    )


async def refresh(d: Deps, tenant: str) -> bool:
    """Read the whole agenda again; False when it could not answer (the mirror stays)."""
    try:
        answer = await d.agenda.items(tenant)
        version, items = answer["agenda_version"], answer["items"]
        if not isinstance(version, int) or not isinstance(items, list):
            raise ValueError("not an agenda answer")
    except Exception as exc:
        log.warning(
            "agenda unreachable (%s): quiet hours stay as last seen",
            type(exc).__name__,
            extra={"tenant": tenant},
        )
        return False
    async with d.db.tenant(tenant) as conn:
        await conn.execute(f"SELECT pg_advisory_xact_lock({LOCK})")
        stored = await _version(conn)
        if stored is not None and version < stored:
            return True  # a slower read than one already mirrored
        await conn.execute("DELETE FROM notify_quiet_hours")
        for row in filter(None, map(_row, items)):
            await _upsert(conn, row)
        await _mirrored(conn, version)
    return True


async def handle(d: Deps, event: Event) -> None:
    """One agenda event, inside its tenant scope."""
    tenant = event.tenant
    if tenant is None:
        return
    if event.type == CLONED:
        await refresh(d, tenant)  # a clone emits no item events: read them
        return
    version = event.data.get("agenda_version")
    if event.type not in ITEM_EVENTS | {REMOVED} or not isinstance(version, int):
        return
    async with d.db.tenant(tenant) as conn:
        stored = await _version(conn)
    if (stored is None or version > stored + 1) and await refresh(d, tenant):
        async with d.db.tenant(tenant) as conn:
            stored = await _version(conn)
    if stored is not None and version <= stored:
        return  # the mirror already has it, or something newer
    async with d.db.tenant(tenant) as conn:
        await conn.execute(f"SELECT pg_advisory_xact_lock({LOCK})")
        # Again under the lock: a full read may have committed since the first look.
        stored = await _version(conn)
        if stored is not None and version <= stored:
            return
        item_id = event.data.get("item_id") if event.type == REMOVED else None
        row = None if event.type == REMOVED else _row(event.data.get("item"))
        if row is not None:
            await _upsert(conn, row)
        else:
            if item_id is None and isinstance(event.data.get("item"), dict):
                item_id = event.data["item"].get("id")  # a kind changed away, or bad times
            await conn.execute("DELETE FROM notify_quiet_hours WHERE item_id = $1", str(item_id))
        # Only the next version in line moves it on: after a missed one (a failed read) the
        # next event reads the agenda again.
        if stored is not None and version == stored + 1:
            await _mirrored(conn, version)


async def refresh_all(d: Deps) -> None:
    """At start-up: every event whose quiet hours Notify mirrors, read again."""
    async with d.db.platform() as conn:
        rows = await conn.fetch("SELECT tenant_id FROM notify_agenda_tenants ORDER BY 1")
    for r in rows:
        with tenant_scope(r["tenant_id"]):
            await refresh(d, r["tenant_id"])


async def active(conn: Any, now: datetime) -> bool:
    """`crew` items and cancelled ones do not count."""
    found: bool = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM notify_quiet_hours WHERE status = 'scheduled'"
        " AND visibility IN ('public', 'attendees') AND starts_at <= $1 AND ends_at > $1)",
        now,
    )
    return found


async def release(conn: Any, now: datetime) -> None:
    """After quiet hours: the newest unexpired held notification per topic and recipient goes
    out (every row of it: each phone and the DM); the rest stay in the inbox only."""
    await conn.execute(
        "WITH held AS (SELECT d.id, n.expires_at > $1 AS live, dense_rank() OVER ("
        "   PARTITION BY d.recipient, n.topic, n.expires_at > $1"
        "   ORDER BY n.created_at DESC, n.id DESC) AS rank"
        " FROM notify_deliveries d JOIN notify_notifications n"
        " ON n.tenant_id = d.tenant_id AND n.id = d.notification_id WHERE d.status = 'held')"
        " UPDATE notify_deliveries d SET"
        " status = CASE WHEN held.live AND held.rank = 1 THEN 'pending' ELSE 'skipped' END,"
        " done_at = CASE WHEN held.live AND held.rank = 1 THEN NULL ELSE $1 END"
        # Checked again on the row itself: a container that waited on another's locks must not
        # put back to pending what that one has claimed (sent twice) since its snapshot.
        " FROM held WHERE d.id = held.id AND d.status = 'held'",
        now,
    )
