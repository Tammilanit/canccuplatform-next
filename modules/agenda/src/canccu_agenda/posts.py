"""The run of show's last post in the event's Discord channel, for the line under the miniature
(docs/design/mockups.html, sheet 5, #433). The bot posts what the agenda's events ask for, on an
item whose channels hold `discord_channel`, public and not quiet hours (contracts/bot.md,
Run-of-show posts; the same rule preview.told shows before a change). The agenda keeps the newest
such event in `agenda_last_post`, stored with it in the change's own transaction, and words it when
a page shows it."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from canccu_kit import Outbox as KitOutbox
from canccu_kit.bus import Event

from .web import hhmm

POSTED = frozenset(
    {
        "agenda.item.delayed",
        "agenda.item.changed",
        "agenda.item.cancelled",
        "agenda.item.announced",
        "agenda.reminder.triggered",
    }
)


def posted(event_type: str, data: dict[str, Any]) -> bool:
    item = data.get("item") or {}
    if event_type not in POSTED or data.get("announce") is False:
        return False
    if event_type == "agenda.item.changed" and "starts_at" not in data.get("changed", ()):
        return False  # an edit is posted only for a new time
    return (
        item.get("visibility") == "public"
        and item.get("kind") != "quiet_hours"
        and "discord_channel" in item.get("notify_channels", ())
    )


class Outbox(KitOutbox):
    """The kit's outbox, which also keeps the last event the bot posts."""

    async def add(
        self,
        conn: Any,
        type: str,
        data: dict[str, Any],
        *,
        version: int,
        correlation_id: str | None = None,
    ) -> Event:
        if posted(type, data):
            await conn.execute(
                "INSERT INTO agenda_last_post (event_type, data, correlation_id)"
                " VALUES ($1, $2::jsonb, $3)"
                " ON CONFLICT (tenant_id) DO UPDATE SET event_type = EXCLUDED.event_type,"
                " data = EXCLUDED.data, correlation_id = EXCLUDED.correlation_id, at = now()"
                " WHERE EXCLUDED.correlation_id IS NULL"
                " OR agenda_last_post.correlation_id IS DISTINCT FROM EXCLUDED.correlation_id",
                type,
                json.dumps(data),
                correlation_id,
            )
        return await super().add(conn, type, data, version=version, correlation_id=correlation_id)


def _at(value: str | None) -> datetime | None:
    return None if value is None else datetime.fromisoformat(value.replace("Z", "+00:00"))


def _minutes(later: datetime | None, earlier: datetime | None) -> int:
    return 0 if later is None or earlier is None else int((later - earlier).total_seconds() // 60)


def words(event_type: str, data: dict[str, Any], tz: ZoneInfo) -> str:
    """The post in a line, as the delay confirm words it (delay_pages)."""
    item = data["item"]
    title, starts = item["title"], _at(item["starts_at"])
    if event_type == "agenda.item.cancelled":
        return f"{title} is cancelled."
    if event_type == "agenda.item.announced" and data.get("message"):
        return str(data["message"])
    ends = _at(item["ends_at"])
    late = _minutes(ends, _at(item["planned_ends_at"]))
    # A running item's delay moves only its end, so its end is later than its start by more than
    # planned, also when it had been delayed before it started (review of #455). An end moved by
    # an edit after a delay looks the same; that is rare enough to word as running late.
    running = item["starts_at"] == item["planned_starts_at"] or late != item["delay_minutes"]
    if event_type == "agenda.item.delayed" and running and ends is not None:
        return f"{title} runs {late} min late, until {hhmm(ends, tz)}"
    if event_type == "agenda.item.delayed":
        return f"{title} starts at {hhmm(starts, tz)} ({item['delay_minutes']} min late)"
    if event_type == "agenda.item.changed":
        return f"{title} now starts at {hhmm(starts, tz)}"
    where = f" · {item['location']}" if item.get("location") else ""
    return f"{title} starts at {hhmm(starts, tz)}{where}"


async def last(conn: Any, tz: ZoneInfo) -> tuple[str, str] | None:
    """When the last post went out, and what it said."""
    row = await conn.fetchrow("SELECT event_type, data, at FROM agenda_last_post")
    if row is None:
        return None
    return hhmm(row["at"], tz), words(row["event_type"], json.loads(row["data"]), tz)
