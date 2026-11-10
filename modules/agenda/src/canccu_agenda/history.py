"""Who changed what, in words (plan issue-187 D13): the item page's change log and the notice a
refused undo or a clashing edit shows."""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any
from zoneinfo import ZoneInfo

from .web import VISIBILITY_LABELS, esc, hhmm

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


def _value(key: str, value: Any, tz: ZoneInfo) -> str:
    if value is None:
        return "—"
    if key in ("starts_at", "ends_at"):
        return hhmm(value, tz)
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
    parts = [
        f"{FIELD_LABELS.get(k, k)}: {_value(k, old.get(k), tz)} → {_value(k, new.get(k), tz)}"
        for k in row["fields"]
    ]
    return f"{who} changed " + ("; ".join(parts) or "nothing visible")


def changes_html(rows: Sequence[Any], tz: ZoneInfo) -> str:
    if not rows:
        return ""
    recent = list(rows)[-SHOWN:][::-1]
    items = "".join(
        f'<li><span class="canccu-agenda-muted">{hhmm(r["at"], tz)}</span> {esc(line(r, tz))}</li>'
        for r in recent
    )
    return f'<section class="canccu-agenda-changes"><h2>Changes</h2><ul>{items}</ul></section>'
