"""Quick-add from a phone in a few taps: a title; when (now, in 30 minutes, or a time); where;
everything else from a template or a kind (plan issue-187 D11)."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from canccu_kit import KitError
from starlette.datastructures import FormData
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import forms, items, model, store, templates, undo
from .day_view import NIGHT_ENDS
from .deps import deps
from .inverse import Inverse
from .web import (
    BASE,
    TIME_PATTERN,
    api_time,
    button,
    day_label,
    esc,
    event_days,
    field,
    next_minute,
    notice,
    page,
    page_writer,
    redirect,
    text_input,
    zone_of,
)

WHEN = (("now", "Now"), ("in30", "In 30 min"), ("at", "At"))
LENGTHS = (("15", "15 min"), ("30", "30 min"), ("60", "1 h"), ("other", "Other…"))


def _chip(minutes: str) -> str:
    """The Length chip of a number of minutes: its own, or Other…"""
    return minutes if minutes in {v for v, _ in LENGTHS} else "other"


def _day(raw: Any, today: date) -> date:
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        return today


def _radio(name: str, value: str, label: str, checked: bool) -> str:
    return (
        f'<label class="canccu-agenda-chip-choice">'
        f'<input type=radio name={name} value="{esc(value)}"'
        f"{' checked' if checked else ''}><span>{esc(label)}</span></label>"
    )


def _button(values: dict[str, Any], day: date) -> str:
    """The button repeats day and time (sheet 5); quickadd.js keeps it in step with the form."""
    when, at = values.get("when") or "now", str(values.get("at") or "")
    if when == "at" and _time(at) is not None:
        return f"Add on {day:%a} at {at}"
    return "Add in 30 min" if when == "in30" else "Add now"


def _form(
    values: dict[str, Any],
    what: list[tuple[str, str]],
    day: date,
    days: list[date],
    auto: str | None,
) -> str:
    """`auto`: the day the form chose by itself (not a link, not the organiser), on which a time
    after midnight moves to the next day; None when nothing may move it."""
    chosen = values.get("what") or (what[0][0] if what else "")
    picks = "".join(_radio("what", v, label, v == chosen) for v, label in what)
    when = values.get("when") or "now"
    whens = "".join(_radio("when", v, label, v == when) for v, label in WHEN)
    on = "".join(_radio("day", d.isoformat(), day_label(d), d == day) for d in days)
    minutes = str(values.get("minutes") or "")
    length = str(values.get("length") or (_chip(minutes) if minutes else ""))
    lengths = "".join(_radio("length", v, label, v == length) for v, label in LENGTHS)
    auto_day = f'<input type=hidden name=day_auto value="{esc(auto)}">' if auto else ""
    return (
        f'<form method=post action="{BASE}/add" class="canccu-agenda-form canccu-agenda-quick">'
        + auto_day
        + '<fieldset class="canccu-agenda-fieldset"><legend>What</legend>'
        + f'<div class="canccu-agenda-chips-row">{picks}</div></fieldset>'
        + field(
            "Title",
            text_input(
                "title", values.get("title") or "", required=True, maxlength=120, autofocus=True
            ),
        )
        + '<fieldset class="canccu-agenda-fieldset"><legend>Day</legend>'
        f'<div class="canccu-agenda-chips-row">{on}</div>'
        '<p class="canccu-field__hint canccu-agenda-night" hidden></p></fieldset>'
        + '<fieldset class="canccu-agenda-fieldset"><legend>When</legend>'
        f'<div class="canccu-agenda-chips-row">{whens}</div>'
        + text_input(
            "at",
            values.get("at") or "",
            inputmode="numeric",
            pattern=TIME_PATTERN,
            placeholder="HH:MM",
            maxlength=5,
            **{"aria-label": "At what time, 24-hour"},
        )
        + "</fieldset>"
        + field(
            "Where",
            text_input("location", values.get("location") or "", maxlength=120),
            "Empty for the template's place.",
        )
        + '<fieldset class="canccu-agenda-fieldset"><legend>Length</legend>'
        f'<div class="canccu-agenda-chips-row">{lengths}</div>'
        + text_input(
            "minutes",
            minutes,
            inputmode="numeric",
            pattern="[0-9]{1,4}",
            maxlength=4,
            **{"aria-label": "Other length, in minutes"},
        )
        + '<p class="canccu-field__hint">None picked: the template\'s length.</p></fieldset>'
        + f'<div class="canccu-agenda-actions">{button(_button(values, day))}'
        f'<a class="canccu-button canccu-button--secondary" href="{BASE}/items/new?day={day}">'
        "Full form</a></div></form>"
        f'<script src="{BASE}/static/quickadd.js" defer></script>'
    )


async def _choices(request: Request) -> tuple[list[tuple[str, str]], list[Any], dict[str, Any]]:
    """Templates first, then the kinds no template already brings, so no choice shows twice
    (UX audit F1). Quiet hours need an end, so only a template offers them."""
    async with deps(request).db.tenant() as conn:
        rows = await templates.all_templates(conn)
        kinds = await store.kinds(conn)
    rows = [r for r in rows if r["kind"] in kinds]  # a removed kind: fix it on its template page
    what = [(f"template:{r['id']}", str(r["name"])) for r in rows]
    covered = {r["kind"] for r in rows} | {"quiet_hours"}
    named = {str(r["name"]).casefold() for r in rows}
    what += [
        (f"kind:{k}", str(r["name"]))
        for k, r in kinds.items()
        if k not in covered and str(r["name"]).casefold() not in named
    ]
    return what, rows, kinds


async def quick_page(request: Request) -> Response:
    await page_writer(request)
    tz, now = zone_of(request), deps(request).now()
    today = now.astimezone(tz).date()
    what, _, _ = await _choices(request)
    named = request.query_params.get("day")
    day = _day(named, today)
    days = event_days(request, today, day)
    # In the small hours the calendar day already is the night's: 01:00 then means in a while,
    # not tomorrow night, so nothing moves (review of #455).
    auto = None if named or now.astimezone(tz).hour < NIGHT_ENDS else day.isoformat()
    return page(request, "Quick add", _form(_from_gap(request), what, day, days, auto))


def _from_gap(request: Request) -> dict[str, str]:
    """A gap's line opens the form at the gap's start, with the room before the next item
    (day_view.gap_html); what is not a time or a length is left out."""
    values: dict[str, str] = {}
    at = request.query_params.get("at", "")
    if _time(at) is not None:
        values.update(when="at", at=at)
    minutes = request.query_params.get("minutes", "")
    if templates.length(minutes) is not None:
        values["minutes"] = minutes
    return values


def _time(raw: str) -> time | None:
    if not re.fullmatch(TIME_PATTERN, raw):
        return None
    try:
        return time.fromisoformat(raw)
    except ValueError:
        return None


def _starts(form: FormData, day: date, now: datetime, tz: ZoneInfo) -> datetime:
    when = form.get("when")
    if when == "in30":
        return now.replace(second=0, microsecond=0) + timedelta(minutes=30)
    if when == "at":
        at = _time(str(form.get("at") or ""))
        if at is None:
            raise model.invalid("pick a time, or now")
        return datetime.combine(day, at, tz)
    return next_minute(now)


def item_fields(
    form: FormData, template: Any, kind: str | None, starts: datetime
) -> dict[str, Any]:
    """The item's fields: the organiser's few, the rest from the template (or the kind)."""
    fields: dict[str, Any] = {
        "title": forms.opt_text(form, "title"),
        "starts_at": api_time(starts),
        "visibility": "public",
        "kind": kind,
    }
    if template is not None:
        fields.update({k: template[k] for k in templates.FIELDS if k not in ("name", "minutes")})
    chip = str(form.get("length") or "")
    raw = chip if chip not in ("", "other") else str(form.get("minutes") or "").strip()
    if chip == "other" and not raw:
        raise model.invalid("give the length in minutes, or pick one")
    minutes = (
        templates.length(raw) if raw else (template["minutes"] if template is not None else None)
    )
    if raw and minutes is None:
        raise model.invalid(templates.LENGTH_RULE)
    if minutes:
        fields["ends_at"] = api_time(starts + timedelta(minutes=minutes))
    location = forms.opt_text(form, "location")
    if location is not None:
        fields["location"] = location
    return fields


def _night(form: FormData, day: date) -> bool:
    """A time after midnight on the day the form chose by itself is the next day's (sheet 5)."""
    at = _time(str(form.get("at") or ""))
    return (
        form.get("day_auto") == day.isoformat()
        and form.get("when") == "at"
        and at is not None
        and at.hour < NIGHT_ENDS
    )


async def quick_add(request: Request) -> Response:
    session = await page_writer(request)
    d = deps(request)
    tz, now = zone_of(request), d.now()
    today = now.astimezone(tz).date()
    form = await request.form()
    posted = _day(form.get("day"), today)
    night = _night(form, posted)
    day = posted + timedelta(days=1) if night else posted
    what, rows, _ = await _choices(request)
    picked = str(form.get("what") or "")
    template = next((r for r in rows if f"template:{r['id']}" == picked), None)
    kind = picked.removeprefix("kind:") if picked.startswith("kind:") else None
    inverse = Inverse()
    try:
        if template is None and kind is None:
            raise model.invalid("pick what it is")
        fields = item_fields(form, template, kind, _starts(form, day, now, tz))
        item = await items.add(d, session, fields, inverse=inverse)
    except KitError as exc:
        # As it was sent, not as moved: the next send moves it once, as this one would have.
        days = event_days(request, today, posted)
        auto = str(form.get("day_auto") or "") or None
        body = notice(exc.message, "error") + _form(dict(form), what, posted, days, auto)
        return page(request, "Quick add", body, status=400)
    added_day = datetime.fromisoformat(item["starts_at"].replace("Z", "+00:00")).astimezone(tz)
    done = "added_next_day" if night else "added"
    path = f"/?day={added_day.date().isoformat()}&done={done}"
    return redirect(undo.with_undo(path, await undo.save(d, session, inverse)), item["id"])


ROUTES = [
    Route("/add", quick_page, methods=["GET"]),
    Route("/add", quick_add, methods=["POST"]),
]
