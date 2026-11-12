"""The reminder scheduler (contracts/agenda.md, Reminders; plan issue-187 D4).

Every write rewrites its items' pending timers in its own transaction (`reschedule`). A loop in
every container (`run`) visits the events listed in `agenda_timer_tenants`, claims their due rows
with FOR UPDATE SKIP LOCKED, so two containers never fire one row, and stores their events in the
outbox in the transaction that deletes them: a timer fires exactly once into the outbox, which
sends it at least once.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Collection, Iterable, Mapping
from datetime import datetime, timedelta
from typing import Any

from canccu_kit import AdminUnavailable, Event, tenant_scope

from . import model, store
from .deps import Deps
from .effective import event_leads, event_settings

log = logging.getLogger("canccu.agenda.timers")

Timer = tuple[str, int, datetime]  # kind, lead_minutes (0 for started and ended), due_at


def wanted(row: Any, kind_leads: Iterable[int] | None, leads: Iterable[int]) -> list[Timer]:
    """Every timer the item has, past ones included; `reschedule` drops what is due already."""
    if row["status"] != "scheduled":
        return []
    lead_list = model.effective_leads(
        None if row["reminder_leads_minutes"] is None else list(row["reminder_leads_minutes"]),
        None if kind_leads is None else list(kind_leads),
        list(leads),
    )
    out: list[Timer] = [
        ("reminder", lead, row["starts_at"] - timedelta(minutes=lead)) for lead in set(lead_list)
    ]
    out.append(("started", 0, row["starts_at"]))
    if row["ends_at"] is not None:
        out.append(("ended", 0, row["ends_at"]))
    return out


async def reschedule(
    conn: Any,
    rows: Iterable[Any],
    kinds: Mapping[str, Any],
    leads: list[int],
    now: datetime,
    *,
    rearm: Collection[str] = frozenset(),
) -> None:
    """Make the items' pending timers match the items, inside the write's transaction.

    A timer that is due but not yet fired stays when the item still wants it at that time, so an
    unrelated edit in the seconds before the loop runs never loses a start. A reminder is added
    only while its time is ahead: a lead that has passed is skipped, and a reminder that fired
    fires again only for the items in `rearm`, those this write moved to a new start in an
    announced change. Any other write (a quiet change, a kind, the lead-time setting) would
    announce a quiet change by firing it again. The fired record is kept when a lead is armed
    again: if that reminder is dropped before it fires (an announced move back), a later quiet
    change must still see the lead as spent. While a reminder for the lead is pending it still
    moves with a quiet change; it has told nobody of this change yet. A start or end that has
    not fired yet always fires, also when a move puts it at or before now: the next tick fires
    it late.
    """
    rows = list(rows)
    if not rows:
        return
    have: dict[str, set[Timer]] = {r["id"]: set() for r in rows}
    for t in await conn.fetch(
        "SELECT item_id, kind, lead_minutes, due_at FROM agenda_timers"
        # Locked: a row the loop is firing right now is waited for, and then is gone here and in
        # agenda_reminders_fired, so this write sees the reminder as fired.
        " WHERE item_id = ANY($1::text[]) FOR UPDATE",
        list(have),
    ):
        have[t["item_id"]].add((t["kind"], t["lead_minutes"], t["due_at"]))
    fired: dict[str, set[int]] = {r: set() for r in have}
    for f in await conn.fetch(
        "SELECT item_id, lead_minutes FROM agenda_reminders_fired WHERE item_id = ANY($1::text[])",
        list(have),
    ):
        fired[f["item_id"]].add(f["lead_minutes"])
    stale: list[tuple[str, str, int]] = []
    new: list[tuple[str, str, int, datetime]] = []
    for row in rows:
        kind = kinds.get(row["kind"])
        want = set(wanted(row, None if kind is None else kind["reminder_leads_minutes"], leads))
        pending = {k for k, _, _ in have[row["id"]] if k != "reminder"}
        armed = {lead for k, lead, _ in have[row["id"]] if k == "reminder"}
        spent = set() if row["id"] in rearm else fired[row["id"]] - armed
        stale += [(row["id"], k, lead) for k, lead, _ in have[row["id"]] - want]
        new += [
            (row["id"], *t)
            for t in want - have[row["id"]]
            if (t[2] > now or t[0] in pending) and not (t[0] == "reminder" and t[1] in spent)
        ]
    if stale:
        await conn.execute(
            "DELETE FROM agenda_timers WHERE (item_id, kind, lead_minutes) IN"
            " (SELECT * FROM unnest($1::text[], $2::text[], $3::int[]))",
            *(list(c) for c in zip(*stale, strict=True)),
        )
    if new:
        await conn.executemany(
            "INSERT INTO agenda_timers (item_id, kind, lead_minutes, due_at)"
            " VALUES ($1, $2, $3, $4)",
            new,
        )
        await conn.execute(
            "INSERT INTO agenda_timer_tenants (tenant_id)"
            " VALUES (current_setting('canccu.tenant')) ON CONFLICT DO NOTHING"
        )


async def reschedule_all(d: Deps) -> None:
    """Every scheduled item of the event in scope, after its lead-time setting changed."""
    leads = await event_leads(d)
    async with d.db.tenant() as conn:
        await store.state(conn, lock=True)
        rows = await conn.fetch(
            f"SELECT {store.ITEM_COLUMNS} FROM agenda_items WHERE status = 'scheduled'"
        )
        await reschedule(conn, rows, await store.kinds(conn), leads, d.now())


async def on_settings_changed(d: Deps, event: Event) -> None:
    """Admin's tenant events, after the SettingsClient has seen them (main.py)."""
    keys = event.data.get("keys")
    if (
        event.type == "admin.settings.changed"
        and event.data.get("module") == "agenda"
        and isinstance(keys, list)
        and "reminder_leads_minutes" in keys
    ):
        await reschedule_all(d)


async def tick(d: Deps, *, batch: int = 100) -> int:
    """Fire what is due in every event that has timers; returns how many events fired."""
    async with d.db.platform() as conn:
        tenants = [
            r["tenant_id"]
            for r in await conn.fetch("SELECT tenant_id FROM agenda_timer_tenants ORDER BY 1")
        ]
    fired = 0
    for tenant in tenants:
        try:
            with tenant_scope(tenant):
                fired += await _fire(d, tenant, batch)
        except AdminUnavailable:
            # The items' channels need admin; the rows stay and fire on a later tick.
            log.warning("admin unreachable; timers wait", extra={"tenant": tenant})
        except Exception:
            log.exception("timers failed", extra={"tenant": tenant})
    return fired


async def _fire(d: Deps, tenant: str, batch: int) -> int:
    now = d.now()
    async with d.db.tenant(tenant) as conn:
        # Most ticks find nothing due: no admin call for them.
        if not await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM agenda_timers WHERE due_at <= $1)", now
        ):
            await _forget_if_idle(conn)
            return 0
    channels, leads = await event_settings(d)
    async with d.db.tenant(tenant) as conn:
        due = await conn.fetch(
            "SELECT item_id, kind, lead_minutes FROM agenda_timers WHERE due_at <= $1"
            # An item that ends as the next starts: its end first, so now and next stay right.
            " ORDER BY due_at, CASE kind WHEN 'ended' THEN 0 WHEN 'reminder' THEN 1 ELSE 2 END,"
            " item_id LIMIT $2 FOR UPDATE SKIP LOCKED",
            now,
            batch,
        )
        rows = {
            r["id"]: r
            for r in await conn.fetch(
                f"SELECT {store.ITEM_COLUMNS} FROM agenda_items WHERE id = ANY($1::text[])",
                list({t["item_id"] for t in due}),
            )
        }
        kinds = await store.kinds(conn)
        published = 0
        told: list[tuple[str, int]] = []  # the reminders fired, for a later quiet change
        for timer in due:
            row = rows[timer["item_id"]]
            if timer["kind"] == "reminder" and row["starts_at"] <= now:
                continue  # late after an outage: a reminder for a start that has passed is noise
            data: dict[str, Any] = {"item": model.item_json(row, kinds, channels)}
            if timer["kind"] == "reminder":
                kind = kinds.get(row["kind"])
                data["lead_minutes"] = timer["lead_minutes"]
                data["leads_minutes"] = model.effective_leads(
                    row["reminder_leads_minutes"],
                    None if kind is None else kind["reminder_leads_minutes"],
                    leads,
                )
                event_type = "agenda.reminder.triggered"
                told.append((row["id"], timer["lead_minutes"]))
            else:
                event_type = f"agenda.item.{timer['kind']}"
            await d.outbox.add(conn, event_type, data, version=1)
            published += 1
        await conn.executemany(
            "DELETE FROM agenda_timers WHERE item_id = $1 AND kind = $2 AND lead_minutes = $3",
            [(t["item_id"], t["kind"], t["lead_minutes"]) for t in due],
        )
        if told:
            await conn.executemany(
                "INSERT INTO agenda_reminders_fired (item_id, lead_minutes) VALUES ($1, $2)"
                " ON CONFLICT DO NOTHING",
                told,
            )
        if len(due) < batch:
            await _forget_if_idle(conn)
    await d.outbox.flush(tenant)
    return published


async def _forget_if_idle(conn: Any) -> None:
    """Drop the event from the scheduler's list once it has no timers left.

    Writers add timers while they hold the event's counter row, so with that row held here a
    write cannot add one between the check and the delete. When a writer holds it, the event
    simply stays listed until a later tick.
    """
    held = await conn.fetchval("SELECT 1 FROM agenda_state FOR UPDATE SKIP LOCKED")
    if held and not await conn.fetchval("SELECT EXISTS (SELECT 1 FROM agenda_timers)"):
        await conn.execute(
            "DELETE FROM agenda_timer_tenants WHERE tenant_id = current_setting('canccu.tenant')"
        )


async def run(d: Deps, interval_seconds: float = 5.0) -> None:
    """The loop every container runs until cancelled."""
    while True:
        try:
            await tick(d)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("timer tick failed")
        await asyncio.sleep(interval_seconds)
