"""Reads and writes of one event's agenda, inside a tenant transaction (`Db.tenant`)."""

from __future__ import annotations

import json
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from canccu_kit.rights import Session

from .model import BUILTIN, STARTER_KINDS, iso

ITEM_COLUMNS = (
    "id, title, description, kind, starts_at, ends_at, planned_starts_at, planned_ends_at,"
    " location, zone, visibility, status, reminder_leads_minutes, notify, tournament_id,"
    " tournament_session_id, moment_id, managed_by, cloned_from, revision"
)


@dataclass(frozen=True)
class Actor:
    """Who a change log row names: a person, or the tournament module (no user)."""

    user_id: str | None
    name: str


TOURNAMENT = Actor(None, "Tournament module")


def actor_of(session: Session) -> Actor:
    return Actor(session.user_id, session.user_name)


async def ensure_event(conn: Any) -> None:
    """The event's counters and starter kinds, made on its first use: the agenda has no job that
    walks every tenant, so an event's rows appear only inside its own context (0013)."""
    created = await conn.fetchval(
        "INSERT INTO agenda_state DEFAULT VALUES ON CONFLICT DO NOTHING RETURNING tenant_id"
    )
    if created is not None:
        await conn.executemany(
            "INSERT INTO agenda_kinds (key, name, builtin) VALUES ($1, $2, true)",
            STARTER_KINDS,
        )


async def state(conn: Any, *, lock: bool = False) -> Any:
    """`agenda_version` and `kinds_version`. With `lock`, the row serialises the event's writes
    until the transaction ends, so versions never skip or repeat."""
    await ensure_event(conn)
    suffix = " FOR UPDATE" if lock else ""
    return await conn.fetchrow(f"SELECT agenda_version, kinds_version FROM agenda_state{suffix}")


async def bump(conn: Any, column: str) -> int:
    assert column in ("agenda_version", "kinds_version")
    value: int = await conn.fetchval(
        f"UPDATE agenda_state SET {column} = {column} + 1 RETURNING {column}"
    )
    return value


async def kinds(conn: Any) -> dict[str, Any]:
    rows = await conn.fetch(
        "SELECT key, name, builtin, reminder_leads_minutes, notify, revision"
        " FROM agenda_kinds ORDER BY position"
    )
    return {row["key"]: row for row in rows}


async def kind(conn: Any, key: str) -> Any:
    return await conn.fetchrow(
        "SELECT key, name, builtin, reminder_leads_minutes, notify, revision"
        " FROM agenda_kinds WHERE key = $1",
        key,
    )


async def save_kind(conn: Any, key: str, values: dict[str, Any], exists: bool) -> Any:
    if exists:
        return await conn.fetchrow(
            "UPDATE agenda_kinds SET name = $2, reminder_leads_minutes = $3, notify = $4,"
            " revision = revision + 1 WHERE key = $1"
            " RETURNING key, name, builtin, reminder_leads_minutes, notify, revision",
            key,
            values["name"],
            values["reminder_leads_minutes"],
            values["notify"],
        )
    return await conn.fetchrow(
        "INSERT INTO agenda_kinds (key, name, builtin, reminder_leads_minutes, notify)"
        " VALUES ($1, $2, $3, $4, $5)"
        " RETURNING key, name, builtin, reminder_leads_minutes, notify, revision",
        key,
        values["name"],
        key in BUILTIN,
        values["reminder_leads_minutes"],
        values["notify"],
    )


async def kind_in_use(conn: Any, key: str) -> bool:
    found: bool = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM agenda_items WHERE kind = $1)", key
    )
    return found


async def item(conn: Any, item_id: str, *, lock: bool = False) -> Any:
    suffix = " FOR UPDATE" if lock else ""
    return await conn.fetchrow(
        f"SELECT {ITEM_COLUMNS} FROM agenda_items WHERE id = $1{suffix}", item_id
    )


async def items(
    conn: Any,
    visibilities: frozenset[str],
    *,
    where: str = "",
    args: tuple[Any, ...] = (),
) -> list[Any]:
    """Items the caller may see, sorted by start; `where` adds conditions on $2, $3, …"""
    extra = f" AND {where}" if where else ""
    rows: list[Any] = await conn.fetch(
        f"SELECT {ITEM_COLUMNS} FROM agenda_items WHERE visibility = ANY($1::text[]){extra}"
        " ORDER BY starts_at, id",
        sorted(visibilities),
        *args,
    )
    return rows


async def insert_item(conn: Any, values: dict[str, Any], actor: Actor) -> Any:
    values = {"id": f"it_{secrets.token_hex(8)}", **values}
    columns = ", ".join(values)
    marks = ", ".join(f"${i}" for i in range(1, len(values) + 1))
    row = await conn.fetchrow(
        f"INSERT INTO agenda_items ({columns}) VALUES ({marks}) RETURNING {ITEM_COLUMNS}",
        *values.values(),
    )
    await _log(conn, row, "added", actor, [], {}, {})
    return row


async def update_item(conn: Any, item_id: str, values: dict[str, Any], actor: Actor) -> Any:
    """Sets `values` (column names from the code, never from a request), bumps `revision` and
    logs the fields that differ."""
    old = await item(conn, item_id)
    sets = ", ".join(f"{column} = ${i}" for i, column in enumerate(values, start=2))
    row = await conn.fetchrow(
        f"UPDATE agenda_items SET {sets}, revision = revision + 1 WHERE id = $1"
        f" RETURNING {ITEM_COLUMNS}",
        item_id,
        *values.values(),
    )
    # A planned time is the API's view of its time: resetting a delay changes `starts_at`'s
    # meaning even when the time itself stays.
    fields = list(dict.fromkeys(k.removeprefix("planned_") for k in values if old[k] != row[k]))
    await _log(
        conn,
        row,
        "changed",
        actor,
        fields,
        {k: to_json(old[k]) for k in fields},
        {k: to_json(row[k]) for k in fields},
    )
    return row


async def delete_item(conn: Any, row: Any, actor: Actor) -> None:
    """Removes an item; its timers go with it (ON DELETE CASCADE), its log stays."""
    await conn.execute("DELETE FROM agenda_items WHERE id = $1", row["id"])
    await _log(conn, row, "removed", actor, [], {}, {})


def to_json(value: Any) -> Any:
    """A column value as the API writes it."""
    if isinstance(value, datetime):
        return iso(value)
    return list(value) if isinstance(value, list | tuple) else value


async def _log(
    conn: Any,
    row: Any,
    action: str,
    actor: Actor,
    fields: list[str],
    old: dict[str, Any],
    new: dict[str, Any],
) -> None:
    await conn.execute(
        "INSERT INTO agenda_changes (item_id, revision, action, actor_user_id, actor_name,"
        " fields, old, new) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)",
        row["id"],
        row["revision"],
        action,
        actor.user_id,
        actor.name,
        fields,
        json.dumps(old),
        json.dumps(new),
    )


async def changes(conn: Any, item_id: str, *, after: int = 0) -> list[Any]:
    """The item's log, oldest first; with `after`, only the revisions after it."""
    rows: list[Any] = await conn.fetch(
        "SELECT revision, action, actor_user_id, actor_name, fields, old, new, at"
        " FROM agenda_changes WHERE item_id = $1 AND revision > $2"
        " ORDER BY revision, action = 'removed', at",
        item_id,
        after,
    )
    return rows
