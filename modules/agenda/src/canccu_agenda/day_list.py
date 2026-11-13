"""The run of show as one continuous list (docs/design/mockups.html, sheet 5, decision 6, #433):
the whole event, a line per day that the day switch jumps to, the past folded behind "N earlier
items", the audience filter, and the now line between what is on and what comes next. No script:
the fold, the filter and the picked item are in the query (`View`); static/day.js only follows the
scroll."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from canccu_kit.ui import icon
from starlette.requests import Request

from . import day_view
from .day_view import state_of
from .web import BASE, day_label, esc, hhmm

# The filter's choices by the list's For column; empty is every item this person may read.
AUDIENCES = (
    ("", "Everyone and crew"),
    ("public", "Everyone"),
    ("attendees", "Attendees"),
    ("crew", "Crew"),
)


@dataclass(frozen=True)
class View:
    """What the query asks of the day view: the audience, the past opened, the picked item."""

    audience: str = ""
    earlier: bool = False
    item: str | None = None

    def href(self, **changes: Any) -> str:
        view = replace(self, **changes)
        query = urlencode(
            {
                k: v
                for k, v in (
                    ("audience", view.audience),
                    ("earlier", "1" if view.earlier else ""),
                    ("item", view.item or ""),
                )
                if v
            }
        )
        return f"{BASE}/?{query}" if query else f"{BASE}/"


def view_of(request: Request, visibilities: frozenset[str] | set[str]) -> View:
    audience = request.query_params.get("audience", "")
    return View(
        audience=audience if audience in visibilities else "",
        earlier=request.query_params.get("earlier") == "1",
        item=request.query_params.get("item") or None,
    )


def _day(row: Any, tz: ZoneInfo) -> date:
    day: date = row["starts_at"].astimezone(tz).date()
    return day


def _fold(earlier: list[Any], view: View, now: datetime, tz: ZoneInfo) -> str:
    count = f"{len(earlier)} earlier item{'' if len(earlier) == 1 else 's'}"
    if view.earlier:
        return (
            f'<li class="canccu-agenda-fold">{icon("right")}<span>{count}</span>'
            f'<a href="{esc(view.href(earlier=False))}">Hide</a></li>'
        )
    last = max(earlier, key=lambda r: r["starts_at"])
    state = "Cancelled" if state_of(last, now) == "cancelled" else "Done"
    return (
        f'<li class="canccu-agenda-fold">{icon("right")}<span>{count} · last: '
        f"{esc(last['title'])} {hhmm(last['starts_at'], tz)}</span>"
        f'<span class="canccu-badge">{state}</span>'
        f'<a href="{esc(view.href(earlier=True))}">Show</a></li>'
    )


def _dayline(day: date, count: int) -> str:
    items = f"{count} item{'' if count == 1 else 's'}"
    return (
        f'<li class="canccu-agenda-dayline" id="day-{day.isoformat()}">'
        f"{day:%A} {day.day} {day:%B} · {items}</li>"
    )


def build(
    rows: list[Any],
    kinds: dict[str, str],
    now: datetime,
    tz: ZoneInfo,
    view: View,
    picked: str | None,
    writes: bool,
) -> tuple[str, list[date]]:
    """The list, and the days it has a line for (the day switch's)."""
    today = now.astimezone(tz).date()
    shown = [r for r in rows if not view.audience or r["visibility"] == view.audience]
    # What has started and is over: a running item stays, whenever it started.
    earlier = [r for r in shown if r["starts_at"] <= now and state_of(r, now) != "running"]
    hidden = set() if view.earlier else {r["id"] for r in earlier}
    visible = [r for r in shown if r["id"] not in hidden]
    counts = Counter(_day(r, tz) for r in shown)
    days = sorted({_day(r, tz) for r in visible} | {today})
    nowline = f'<li class="canccu-agenda-nowline" id="now"><span>Now {hhmm(now, tz)}</span></li>'
    lines = [_fold(earlier, view, now, tz)] if earlier else []
    for day in days:
        on_day = [r for r in visible if _day(r, tz) == day]
        lines.append(_dayline(day, counts[day]))
        now_due = day == today
        for i, row in enumerate(on_day):
            if now_due and row["starts_at"] > now:
                lines.append(nowline)
                now_due = False
            href = view.href(item=row["id"]) + f"#r-{row['id']}"
            lines.append(day_view.row_html(row, kinds, now, tz, href, row["id"] == picked))
            if writes and i + 1 < len(on_day):
                lines.append(day_view.gap_html(row, on_day[i + 1], tz, day))
        if now_due:
            lines.append(nowline)
        if writes:
            lines.append(day_view.add_row_html(day))
    return day_view.list_html(lines), days


def filter_html(view: View, visibilities: frozenset[str] | set[str]) -> str:
    """The audience filter; the script sends it on a change, so its button is for no script."""
    options = "".join(
        f'<option value="{value}"{" selected" if value == view.audience else ""}>{label}</option>'
        for value, label in AUDIENCES
        if not value or value in visibilities
    )
    keep = '<input type=hidden name=earlier value="1">' if view.earlier else ""
    return (
        f'<form class="canccu-agenda-filter" method=get action="{BASE}/">{keep}'
        f'<select class="canccu-input" name=audience aria-label="For whom">{options}</select>'
        '<button class="canccu-button canccu-button--secondary canccu-agenda-filter__go">'
        "Show</button></form>"
    )


def days_html(days: list[date], current: date, filters: str) -> str:
    """The day switch jumps to a day's line (the script then follows the scroll), the audience
    filter, and Jump to now."""
    mark = ' aria-current="true"'
    links = "".join(
        f'<a href="#day-{d.isoformat()}"{mark if d == current else ""}>{day_label(d)}</a>'
        for d in days
    )
    return (
        f'<div class="canccu-agenda-bar"><nav class="canccu-agenda-days" aria-label="Days">{links}'
        f"</nav>{filters}"
        f'<a class="canccu-button canccu-button--ghost canccu-button--sm" href="#now">'
        f"{icon('clock')}Jump to now</a></div>"
    )


def strip_html(row: Any, now: datetime, tz: ZoneInfo) -> str:
    """On a phone, what is on now stays in view once the hero has scrolled away (day.js)."""
    if state_of(row, now) == "running":
        what, when = f"On now: {esc(row['title'])}", f"until {hhmm(row['ends_at'], tz)}"
    else:
        what, when = f"Up next: {esc(row['title'])}", hhmm(row["starts_at"], tz)
    return (
        f'<div class="canccu-agenda-strip"><span><b>{what}</b> · {when} '
        f"{day_view.late_badge(row)}</span>"
        f'<a class="canccu-button canccu-button--secondary" href="#now">{icon("clock")}Now</a>'
        "</div>"
    )
