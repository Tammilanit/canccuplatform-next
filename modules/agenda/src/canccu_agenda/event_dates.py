"""The event's dates as the pages use them: its days in its time zone, the days a form offers,
and whether it is over. They come from the tenants module (`request.state.agenda_event`)."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from starlette.requests import Request

from .web import zone_of

# A longer event (or one with odd dates) offers no day list of its own: today, tomorrow and the
# form's own days stay.
MAX_EVENT_DAYS = 31


def _parsed(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def event_span(request: Request) -> tuple[date, date] | None:
    """The event's first and last day in its time zone; None while it has no dates."""
    event = getattr(request.state, "agenda_event", None)
    if event is None or not event.starts_at or not event.ends_at:
        return None
    tz = zone_of(request)
    first, last = (_parsed(v).astimezone(tz).date() for v in (event.starts_at, event.ends_at))
    return first, last


def event_days(request: Request, today: date, *extra: date | None) -> list[date]:
    """The days a form offers: the event's own and one on each side for setting up and clearing
    away (when it has dates, at most MAX_EVENT_DAYS), today and tomorrow, and the days the form
    already holds. "Other date…" reaches the rest."""
    days = {today, today + timedelta(days=1), *(d for d in extra if d is not None)}
    span = event_span(request)
    if span is not None and 0 <= (span[1] - span[0]).days < MAX_EVENT_DAYS:
        first, last = span
        days |= {first + timedelta(days=n) for n in range(-1, (last - first).days + 2)}
    return sorted(days)


def event_over(request: Request, now: datetime) -> bool:
    """Whether the event has ended: a cancelled item comes back only until then (sheet 5)."""
    event = getattr(request.state, "agenda_event", None)
    return bool(event is not None and event.ends_at and _parsed(event.ends_at) <= now)
