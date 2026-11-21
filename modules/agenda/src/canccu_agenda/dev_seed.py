"""The demo run of show on the dev server (#715): `setup/deploy` runs
`python -m canccu_agenda dev-seed` after admin's seed (#709), in dev mode only, so the demo event's
agenda has something to show and to demo with. The items fall on today and tomorrow of the event's
time zone, counted from the day of the run, so a demo is always current.

The seed adds through the same path as `POST /api/agenda/items`, as its own actor (no user), so
screens, phones, reminders and Moments see ordinary items. It owns the agenda while every change
since its last run is its own: then a run on a later day moves the run of show to that day. An
item added, edited, delayed or removed by anyone else (a person, the tournament module) keeps it
out. `--force` (resetting the demo event, docs/operations/dev-server.md) removes every item the
tournament module does not manage and adds the demo run of show again."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from canccu_kit import DEMO_TENANT, tenant_scope

from . import edits, items, model, store
from .deps import Deps

# No user is named so: a person's change always carries their user id.
SEED = store.Actor(None, "Demo seed")

# (day: 0 today, 1 tomorrow; local start; minutes, None for a moment in time; kind; title;
# location). Moments' seed finds the next raffle by its title (modules/moments/src/dev-seed.ts):
# one each day, so there is one ahead after today's too.
DEMO_RUN: tuple[tuple[int, str, int | None, str, str, str], ...] = (
    (0, "16:00", None, "doors", "Doors open", "Main entrance"),
    (0, "17:00", 120, "tournament", "Tournament: group stage", "Main hall"),
    (0, "18:00", 30, "meal", "Pizza order", "Food table"),
    (0, "19:30", 60, "meal", "Dinner", "Food table"),
    (0, "21:00", 30, "activity", "Raffle", "Main stage"),
    (1, "10:00", 60, "meal", "Breakfast", "Food table"),
    (1, "12:00", 180, "tournament", "Tournament: finals", "Main stage"),
    (1, "15:15", 30, "activity", "Raffle", "Main stage"),
    (1, "16:00", 30, "ceremony", "Closing ceremony", "Main stage"),
)

SEEDED = "added the demo run of show for today and tomorrow"
UP_TO_DATE = "the demo event holds today's demo run of show; nothing changed"
HAND_MADE = (
    "the demo event's run of show was changed by hand; nothing changed"
    " (reset the demo event to add the demo run of show again)"
)


class Refused(Exception):
    """Nothing was changed; the message says why."""


def demo_items(today: date, zone: ZoneInfo) -> list[dict[str, Any]]:
    """The demo run of show as request bodies, on `today` and the day after in `zone`."""
    out = []
    for day, at, minutes, kind, title, location in DEMO_RUN:
        starts = datetime.combine(today + timedelta(days=day), time.fromisoformat(at), zone)
        ends = None if minutes is None else starts + timedelta(minutes=minutes)
        out.append(
            {
                "title": title,
                "kind": kind,
                "starts_at": model.iso(starts),
                "ends_at": model.iso(ends),
                "location": location,
                "visibility": "public",
            }
        )
    return out


async def _state(conn: Any) -> tuple[bool, datetime | None]:
    """Whether anyone else changed the agenda since the seed's last run, and that run's time."""
    last: datetime | None = await conn.fetchval(
        "SELECT max(at) FROM agenda_changes"
        " WHERE actor_user_id IS NULL AND actor_name = $1 AND action = 'added'",
        SEED.name,
    )
    others = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM agenda_changes"
        " WHERE (actor_user_id IS NOT NULL OR actor_name <> $1)"
        " AND ($2::timestamptz IS NULL OR at > $2))",
        SEED.name,
        last,
    )
    return bool(others), last


async def _remove(d: Deps, row: Any) -> None:
    """Removes as `DELETE /api/agenda/items/{id}` does, as the seed."""
    async with d.db.tenant() as conn:
        await store.state(conn, lock=True)
        version = await edits.remove(conn, row, SEED)
        await d.outbox.add(
            conn,
            "agenda.item.removed",
            {
                "item_id": row["id"],
                "visibility": row["visibility"],
                "agenda_version": version,
                "actor_user_id": None,
            },
            version=1,
        )
    await d.outbox.flush()


async def seed_demo_agenda(d: Deps, version: str, time_zone: str, *, force: bool) -> str:
    if version != "dev":
        raise Refused(f"CANCCU_VERSION is {version}, not dev: nothing changed")
    zone = ZoneInfo(time_zone)
    today = d.now().astimezone(zone).date()
    with tenant_scope(DEMO_TENANT):
        async with d.db.tenant() as conn:
            await store.state(conn)
            others, last = await _state(conn)
            rows = await store.items(conn, frozenset(model.VISIBILITIES))
        if not force:
            if others:
                return HAND_MADE
            first: datetime | None = min((r["planned_starts_at"] for r in rows), default=None)
            if last is not None and first is not None and first.astimezone(zone).date() == today:
                return UP_TO_DATE
        for row in rows:
            if row["managed_by"] is None:
                await _remove(d, row)
        for data in demo_items(today, zone):
            await items.add_as(d, SEED, data)
    return SEEDED
