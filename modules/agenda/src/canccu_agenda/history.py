"""Who changed what, in words (plan issue-187 D13): the item page's change log and the notice a
refused undo or a clashing edit shows."""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from .web import VISIBILITY_LABELS, day_label, esc, hhmm

FIELD_LABELS = {
    "title": "title",
    "description": "about",
    "kind": "kind",
    "starts_at": "start",
    "ends_at": "end",
    "location": "place",
    "zone": "zone",
    "visibility": "who sees it",
    "reminder_leads_minutes": "reminders",
    "notify": "channels",
    "status": "status",
}
SHOWN = 10


def _day(value: str | datetime, tz: ZoneInfo) -> date:
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.astimezone(tz).date()


def _time(value: str | datetime, tz: ZoneInfo, with_day: bool) -> str:
    return f"{day_label(_day(value, tz))} {hhmm(value, tz)}" if with_day else hhmm(value, tz)


def _value(key: str, value: Any, tz: ZoneInfo, with_day: bool = False) -> str:
    if value is None:
        return "—"
    if key in ("starts_at", "ends_at"):
        return _time(value, tz, with_day)
    if key == "visibility":
        return VISIBILITY_LABELS.get(value, str(value))
    if isinstance(value, list):
        return ", ".join(map(str, value)) or "none"
    return str(value)


def labels(fields: Sequence[str]) -> str:
    return ", ".join(FIELD_LABELS.get(f, f) for f in fields)


def line(row: Any, tz: ZoneInfo) -> str:
    """One change: "Riley changed title: Dinner → Supper; start: 18:00 → 18:15"."""
    who = row["actor_name"]
    if row["action"] != "changed":
        return f"{who} {row['action']} it"
    old, new = json.loads(row["old"]), json.loads(row["new"])
    parts = []
    for k in row["fields"]:
        before, after = old.get(k), new.get(k)
        # A move to another day would otherwise read "18:00 → 18:00".
        days = (
            k in ("starts_at", "ends_at")
            and before is not None
            and after is not None
            and _day(before, tz) != _day(after, tz)
        )
        label = FIELD_LABELS.get(k, k)
        parts.append(f"{label}: {_value(k, before, tz, days)} → {_value(k, after, tz, days)}")
    return f"{who} changed " + ("; ".join(parts) or "nothing visible")


def changes_html(rows: Sequence[Any], tz: ZoneInfo, today: date) -> str:
    if not rows:
        return ""
    recent = list(rows)[-SHOWN:][::-1]
    items = "".join(
        f'<li><span class="canccu-agenda-muted">{_time(r["at"], tz, _day(r["at"], tz) != today)}'
        f"</span> {esc(line(r, tz))}</li>"
        for r in recent
    )
    return f'<section class="canccu-agenda-changes"><h2>Changes</h2><ul>{items}</ul></section>'
