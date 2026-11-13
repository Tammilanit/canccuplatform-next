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
from .deps import deps
from .inverse import Inverse
from .web import (
    BASE,
    TIME_PATTERN,
    api_time,
    button,
    day_label,
    esc,
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


def _form(values: dict[str, Any], what: list[tuple[str, str]], day: date, today: date) -> str:
    chosen = values.get("what") or (what[0][0] if what else "")
    picks = "".join(_radio("what", v, label, v == chosen) for v, label in what)
    when = values.get("when") or "now"
    whens = "".join(_radio("when", v, label, v == when) for v, label in WHEN)
    on_day = "" if day == today else f" on {day_label(day)}"
    return (
        f'<form method=post action="{BASE}/add" class="canccu-agenda-form">'
        f'<input type=hidden name=day value="{day.isoformat()}">'
        + field(
            "Title",
            text_input(
                "title", values.get("title") or "", required=True, maxlength=120, autofocus=True
            ),
        )
        + '<fieldset class="canccu-agenda-fieldset"><legend>What</legend>'
        + f'<div class="canccu-agenda-chips-row">{picks}</div></fieldset>'
        + f'<fieldset class="canccu-agenda-fieldset"><legend>When{esc(on_day)}</legend>'
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
            "Length",
            text_input(
                "minutes",
                values.get("minutes") or "",
                inputmode="numeric",
                pattern="[0-9]{1,4}",
                maxlength=4,
            ),
            "Minutes. Empty for the template's length.",
        )
        + field(
            "Where",
            text_input("location", values.get("location") or "", maxlength=120),
            "Empty for the template's place.",
        )
        + f'<div class="canccu-agenda-actions">{button("Add")}'
        f'<a class="canccu-button canccu-button--secondary" href="{BASE}/items/new?day={day}">'
        "Full form</a></div></form>"
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
    day = _day(request.query_params.get("day"), today)
    return page(request, "Quick add", _form(_from_gap(request), what, day, today))


def _from_gap(request: Request) -> dict[str, str]:
    """A gap's line opens the form at the gap's start, with the room before the next item
    (day_view.gap_html); what is not a time or a length is left out."""
    values: dict[str, str] = {}
    at = request.query_params.get("at", "")
    if _time(at) is not None:
        values.update(when="at", at=at)
    minutes = request.query_params.get("minutes", "")
    if _length(minutes) is not None:
        values["minutes"] = minutes
    return values


def _time(raw: str) -> time | None:
    if not re.fullmatch(TIME_PATTERN, raw):
        return None
    try:
        return time.fromisoformat(raw)
    except ValueError:
        return None


def _length(raw: str) -> int | None:
    """Minutes, up to a day: a longer item is the full form's."""
    return int(raw) if raw.isascii() and raw.isdigit() and 0 < int(raw) <= 1440 else None


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
    raw = str(form.get("minutes") or "").strip()
    minutes = _length(raw) if raw else (template["minutes"] if template is not None else None)
    if raw and minutes is None:
        raise model.invalid("the length is in minutes, from 1 to 1440")
    if minutes:
        fields["ends_at"] = api_time(starts + timedelta(minutes=minutes))
    location = forms.opt_text(form, "location")
    if location is not None:
        fields["location"] = location
    return fields


async def quick_add(request: Request) -> Response:
    session = await page_writer(request)
    d = deps(request)
    tz, now = zone_of(request), d.now()
    today = now.astimezone(tz).date()
    form = await request.form()
    day = _day(form.get("day"), today)
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
        body = notice(exc.message, "error") + _form(dict(form), what, day, today)
        return page(request, "Quick add", body, status=400)
    added_day = datetime.fromisoformat(item["starts_at"].replace("Z", "+00:00")).astimezone(tz)
    path = f"/?day={added_day.date().isoformat()}&done=added"
    return redirect(undo.with_undo(path, await undo.save(d, session, inverse)))


ROUTES = [
    Route("/add", quick_page, methods=["GET"]),
    Route("/add", quick_add, methods=["POST"]),
]
