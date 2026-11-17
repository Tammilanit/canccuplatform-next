"""Times on the run-of-show pages: each shown and read in the event's own time zone, and sent to
the API in UTC."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from canccu_kit import KitError, ui
from starlette.requests import Request

from .access import tenant_of


def zone_of(request: Request) -> ZoneInfo:
    """The event's time zone: every time a page shows or reads is in it."""
    try:
        return ZoneInfo(tenant_of(request)["time_zone"])
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def hhmm(value: datetime | str | None, tz: ZoneInfo) -> str:
    return "" if value is None else ui.time_label(value, str(tz))


def day_label(day: date) -> str:
    return f"{day:%a} {day.day} {day:%b}"  # canccu_kit.ui's day format, for a date


def local_input(value: str | None, tz: ZoneInfo) -> str:
    """An API time as a datetime-local value."""
    if not value:
        return ""
    return (
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        .astimezone(tz)
        .strftime("%Y-%m-%dT%H:%M")
    )


def from_local(value: str, tz: ZoneInfo, field: str) -> str:
    """A datetime-local value, read in the event's time zone, as an API time."""
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise KitError(f"{field}: give a date and a time", status=400) from None
    return api_time(parsed.replace(tzinfo=tz))


def api_time(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def next_minute(now: datetime) -> datetime:
    """'Now' on a page: the next whole minute, so the item is still ahead when it lands."""
    return now.replace(second=0, microsecond=0) + timedelta(minutes=1)


def iso_day(raw: str) -> date | None:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def typed_day(raw: str) -> date | None:
    """A day typed as DATE_PATTERN has it; the weekday, when given, is not checked."""
    parts = raw.split()
    try:
        return datetime.strptime(" ".join(parts[-3:]), "%d %b %Y").date()
    except ValueError:
        return None


def posted_when(form: Any, name: str) -> str:
    """A posted day and time as one datetime-local value; a form that sends the value whole
    (an older page, a test) still works. A day without a time is no value: the day field always
    holds one. An "Other date…" the form cannot read stays as typed, so the time is refused."""
    if f"{name}_day" not in form and f"{name}_time" not in form:
        return str(form.get(name) or "")
    day, hm = str(form.get(f"{name}_day") or ""), str(form.get(f"{name}_time") or "")
    if day == "other":
        typed = str(form.get(f"{name}_other") or "").strip()
        found = typed_day(typed) if len(typed.split()) in (3, 4) else None
        day = found.isoformat() if found else typed
    return f"{day}T{hm}" if hm else ""
