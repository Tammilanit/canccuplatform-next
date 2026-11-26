"""An example of what a phone shows for each kind of notification (#782 part C, plan D14): the
first event-wide trigger's title and body (else the first trigger's), filled by the engine with
demo values. No registration carries an example (plan Q6), so a module's new path shows "…"
until a sample is added here."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from . import engine

ELLIPSIS = "…"
# Demo values by path: times are clock times on the day shown, in the event's zone.
SAMPLES: dict[str, Any] = {
    "data.item.title": "Opening ceremony",
    "data.item.kind": "ceremony",
    "data.item.starts_at": time(18, 0),
    "data.item.planned_starts_at": time(17, 45),
    "data.lead_minutes": 10,
    "data.minutes": 15,
    "data.message": "Find a seat in the main hall.",
    "data.order.pizzeria.name": "Demo Pizzeria",
    "data.order.seq": 3,
    "data.order.closes_at": time(19, 30),
    "data.closes_at": time(19, 30),
    "data.order.pizza_count": 12,
    "data.order.pickup": "the info desk",
    "data.title": "Doors open in 10 minutes",
    "data.body": "Have your ticket ready at the entrance.",
}


def _first(reg: dict[str, Any]) -> dict[str, Any] | None:
    triggers: list[dict[str, Any]] = reg.get("triggers") or []
    parts = reg.get("parts") or {}
    for trigger in triggers:
        if (parts.get(trigger.get("part")) or {}).get("scope") == "event":
            return trigger
    return triggers[0] if triggers else None


def _fill(template: str, tz: ZoneInfo, today: date) -> str:
    def one(m: Any) -> str:
        path, formatter = m.group(1), m.group(2)
        sample = SAMPLES.get(path)
        if sample is None:
            return ELLIPSIS
        if isinstance(sample, time):
            sample = engine.iso_time(datetime.combine(today, sample, tz))
        return engine.format_value(sample, formatter, tz) or ELLIPSIS

    return engine.TEMPLATE_RE.sub(one, template)


def example_for(reg: dict[str, Any], time_zone: str, today: date) -> tuple[str, str]:
    """(title, body) as a phone would show them today; ("", "") for a type with no trigger."""
    trigger = _first(reg)
    if trigger is None:
        return "", ""
    tz = ZoneInfo(time_zone)
    return _fill(str(trigger.get("title", "")), tz, today), _fill(
        str(trigger.get("body", "")), tz, today
    )
