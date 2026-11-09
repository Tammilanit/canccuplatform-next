"""Templates for recurring items (plan issue-187 D11): page data for quick-add, so they carry
what a kind does not, a default length. Not in the API, so the contract stays as it is."""

from __future__ import annotations

import secrets
from typing import Any

from . import model, store

# A new event's starters (Q4), all editable: (name, kind, minutes).
STARTERS = (("Food", "meal", 60), ("Ceremony", "ceremony", 30), ("Game session", "activity", 120))
COLUMNS = "id, name, kind, minutes, location, zone, visibility, reminder_leads_minutes, notify"
FIELDS = COLUMNS.split(", ")[1:]


async def ensure(conn: Any) -> None:
    """Makes the starters once per event, in its own context; an organiser who removes them all
    does not get them back."""
    await store.ensure_event(conn)
    first = await conn.fetchval(
        "UPDATE agenda_state SET templates_seeded = true WHERE NOT templates_seeded RETURNING true"
    )
    if first:
        await conn.executemany(
            "INSERT INTO agenda_templates (id, name, kind, minutes, visibility)"
            " VALUES ($1, $2, $3, $4, 'public')",
            [(new_id(), name, kind, minutes) for name, kind, minutes in STARTERS],
        )


def new_id() -> str:
    return f"tp_{secrets.token_hex(6)}"


async def all_templates(conn: Any) -> list[Any]:
    await ensure(conn)
    rows: list[Any] = await conn.fetch(f"SELECT {COLUMNS} FROM agenda_templates ORDER BY position")
    return rows


async def one(conn: Any, template_id: str) -> Any:
    await ensure(conn)
    return await conn.fetchrow(f"SELECT {COLUMNS} FROM agenda_templates WHERE id = $1", template_id)


def checked(values: dict[str, Any]) -> dict[str, Any]:
    """The API's own field rules, so a template never holds what an item could not."""
    minutes = values.get("minutes")
    if minutes is not None and (type(minutes) is not int or not 1 <= minutes <= 1440):
        raise model.invalid("length must be 1-1440 minutes, or empty for a moment in time")
    if values.get("kind") == "quiet_hours" and minutes is None:
        raise model.invalid("a quiet hours template needs a length")
    return {
        "name": model.text(values.get("name"), "name", 60, required=True),
        "kind": model.kind_key(values.get("kind")),
        "minutes": minutes,
        "location": model.text(values.get("location"), "location", 120),
        "zone": model.zone(values.get("zone")),
        "visibility": model.visibility(values.get("visibility")),
        "reminder_leads_minutes": model.leads(values.get("reminder_leads_minutes")),
        "notify": model.channels(values.get("notify")),
    }


async def save(conn: Any, template_id: str | None, values: dict[str, Any]) -> Any:
    values = checked(values)
    await ensure(conn)
    if await store.kind(conn, values["kind"]) is None:
        raise model.invalid(f"unknown kind {values['kind']}")
    if template_id is None:
        marks = ", ".join(f"${i}" for i in range(2, len(FIELDS) + 2))
        return await conn.fetchrow(
            f"INSERT INTO agenda_templates (id, {', '.join(FIELDS)}) VALUES ($1, {marks})"
            f" RETURNING {COLUMNS}",
            new_id(),
            *(values[f] for f in FIELDS),
        )
    sets = ", ".join(f"{f} = ${i}" for i, f in enumerate(FIELDS, start=2))
    return await conn.fetchrow(
        f"UPDATE agenda_templates SET {sets} WHERE id = $1 RETURNING {COLUMNS}",
        template_id,
        *(values[f] for f in FIELDS),
    )


async def remove(conn: Any, template_id: str) -> None:
    await conn.execute("DELETE FROM agenda_templates WHERE id = $1", template_id)
