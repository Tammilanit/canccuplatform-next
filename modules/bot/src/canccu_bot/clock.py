"""Times as the commands and posts say them: HH:MM in the event's time zone."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_HHMM = re.compile(r"^\s*([01]?[0-9]|2[0-4])[:.]([0-5][0-9])\s*$")


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def hhmm(value: str | datetime | None, time_zone: str) -> str:
    """ "20:45" in the event's zone; "" for no time."""
    if value is None or value == "":
        return ""
    at = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    return at.astimezone(zone(time_zone)).strftime("%H:%M")


def minute_of(text: str) -> int | None:
    """ "21:00" or "21.00" → minutes after midnight, 0 to 1440 ("24:00" is the day's end)."""
    found = _HHMM.match(text or "")
    if found is None:
        return None
    minute = int(found.group(1)) * 60 + int(found.group(2))
    return minute if minute <= 1440 else None


def next_at(minute: int, now: datetime, time_zone: str) -> datetime:
    """The next time the event's clock shows `minute`: today, or tomorrow when it has passed."""
    local = now.astimezone(zone(time_zone))
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    at = midnight + timedelta(minutes=minute)
    return at if at > local else at + timedelta(days=1)
