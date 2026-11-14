"""The frame of the run-of-show pages: phone-first, server-rendered, no script (plan issue-187 D8).

Caddy serves the pages under /agenda/ and strips the prefix, so routes here are `/`, `/add`, …
while every link a page writes carries `/agenda`.
"""

from __future__ import annotations

import logging
import os
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from canccu_kit import (
    KitError,
    MissingRight,
    TenantResolver,
    check_admin_access,
    tailscale_cidrs,
    ui,
)
from canccu_kit.rights import Session
from canccu_kit.ui import esc as esc  # the pages' escaping, re-exported
from canccu_kit.web_security import event_page_csp, new_nonce
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from .access import CREW_READ, WRITE, tenant_of, writer
from .deps import deps

BASE = "/agenda"
SIGN_IN = "/admin/sign-in"
_STATIC = Path(__file__).resolve().parent / "static"
# The image sets CANCCU_UI_CSS; elsewhere packages/ui sits beside this module's source (an
# editable install), while an installed kit has no packages/ui next to it.
UI_CSS = Path(
    os.environ.get("CANCCU_UI_CSS", Path(__file__).resolve().parents[4] / "packages/ui/ui.css")
)
# The run of show's own pages, as tabs under its title (docs/design/mockups.html, sheet 2). Quick
# add is an action, so it is the page's button and the bar's, never a tab: nothing twice.
TABS = (("/", "Run of show"), ("/templates", "Templates"))
STYLESHEETS = ("ui.css", "agenda.css", "list.css", "confirm.css", "gap.css")
CSS = tuple(f"{BASE}/static/{name}" for name in STYLESHEETS)
SCRIPTS = ("day.js", "quickadd.js")
# A 24-hour time: native time fields follow the browser's locale, which may be 12-hour (UX B5).
TIME_PATTERN = "[0-2][0-9]:[0-5][0-9]"
# "Other date…": a day typed in the event's format with its year, "16 Mar 2027" (or "Tue 16 Mar
# 2027"), so a form reaches any day, not only those it offers.
DATE_PATTERN = "([A-Za-z]{3} )?[0-9]{1,2} [A-Za-z]{3} [0-9]{4}"
# A longer event (or one with odd dates) offers no day list of its own: today, tomorrow and the
# form's own days stay.
MAX_EVENT_DAYS = 31
log = logging.getLogger("canccu.agenda")
VISIBILITY_LABELS = {"public": "Everyone", "attendees": "Attendees", "crew": "Crew only"}
CHANNEL_LABELS = {
    "screen": "Screen notice",
    "discord_channel": "Discord channel",
    "discord_dm": "Discord DM",
    "push": "Push",
}


async def page_session(request: Request) -> Session:
    """The session of a page: the run-of-show is for organisers and crew (plan D9). A missing
    session raises NotSignedIn, which app.py turns into the way to sign in."""
    ctx = tenant_of(request)
    session = await deps(request).rights.session(request.headers.get("cookie"))
    request.state.agenda_session = session
    if not (session.has(WRITE) or session.has(CREW_READ)):
        raise MissingRight(f"needs right {WRITE} or {CREW_READ}")
    check_admin_access(ctx, request.client.host if request.client else None, tailscale_cidrs())
    request.state.agenda_event = await event_of(request)
    if ctx["status"] == "archived":
        # Read only (sheets 2 and 8): the pages draw no change at all, as for crew who read.
        session = replace(session, rights=session.rights - {WRITE})
        request.state.agenda_session = session
    return session


def archived(request: Request) -> bool:
    return bool(tenant_of(request)["status"] == "archived")


# What an item of an archived event says instead of its actions (sheet 8, Errors).
ARCHIVED_ITEM = "The event is archived, so this item can't be delayed, edited or cancelled."


async def page_writer(request: Request) -> Session:
    """The session of a page that writes (access.writer), with the event the shell's header names:
    every page in the shell shows the same header (#390)."""
    session = await writer(request)
    request.state.agenda_event = await event_of(request)
    return session


async def event_of(request: Request) -> ui.EventInfo | None:
    """The event the shell's header names (canccu_kit.ui)."""
    resolver: TenantResolver | None = getattr(request.app.state, "tenants", None)
    return None if resolver is None else await resolver.event(request.headers.get("host"))


def page(
    request: Request,
    title: str,
    body: str,
    *,
    status: int = 200,
    session: Session | None = None,
    actions: str = "",
    description: str = "",
    back: bool = True,
    plain: bool = False,
    narrow: bool = True,
) -> HTMLResponse:
    """A run-of-show page in the organiser shell: the three main pages carry the tabs, the others
    a way back to the run of show."""
    # The session a page's check already read (access.remember); without one, as on an error
    # page, the shell shows no menu.
    session = session or getattr(request.state, "agenda_session", None)
    path = request.url.path
    tabs: list[tuple[str, str, bool]] = []
    if session is not None and session.has(WRITE) and path in (p for p, _ in TABS):
        tabs = [(f"{BASE}{p}", label, p == path) for p, label in TABS]
    crumb = None if tabs or not back or path == "/" else (f"{BASE}/", "Run of show")
    doc = ui.shell_page(
        title,
        body,
        session=session,
        event=getattr(request.state, "agenda_event", None),
        current="agenda",
        css=CSS,
        tabs=tabs,
        crumb=crumb,
        actions=actions,
        description=esc(description),
        narrow=narrow,
        plain=plain,
    )
    response = HTMLResponse(doc, status_code=status)
    host = request.url.hostname or "localhost"
    response.headers["Content-Security-Policy"] = event_page_csp(new_nonce(), host, page="admin")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def redirect(path: str) -> RedirectResponse:
    return RedirectResponse(f"{BASE}{path}", status_code=303)


def notice(message: str, kind: str = "ok") -> str:
    """A notice in the module's words: `ok` or `error`."""
    return ui.notice("down" if kind == "error" else "ok", message)


async def error_page(request: Request, exc: KitError) -> Response:
    """A refusal said in words, with the way on (canccu_kit.ui); a missing right goes to the
    log, never to the page (UX audit B3)."""
    if isinstance(exc, MissingRight):
        log.info("page %s refused: %s", request.url.path, exc.message)
        session = getattr(request.state, "agenda_session", None)
        if session is not None and not session.rights:  # admin's "No role yet" says what to do
            return RedirectResponse(SIGN_IN, status_code=303)
    if exc.code == "version_conflict":
        exc = KitError(
            "Someone changed this item meanwhile. Open it again to see it as it is now.",
            status=exc.status,
            code=exc.code,
        )
    event = getattr(request.state, "agenda_event", None) or await event_of(request)
    request.state.agenda_event = event
    title, view = ui.error_view(
        exc,
        session=getattr(request.state, "agenda_session", None),
        page="the run of show",
        event=event.name if event else None,
        retry=f"{BASE}{request.url.path}",
        back=(f"{BASE}/", "Back to the run of show"),
    )
    return page(request, title, view, status=exc.status, plain=True)


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


def when_inputs(
    name: str,
    label: str,
    value: str | None,
    days: list[date],
    *,
    required: bool = False,
    fallback: date | None = None,
) -> str:
    """A day and a 24-hour time for a datetime-local value (`posted_when` joins them back). The
    day is a choice of the event's days in its own format ("Sat 14 Mar", sheet 1): a native date
    field follows the browser's locale (mm/dd/yyyy). "Other date…" reaches any other day, typed
    in the same format. Without a value the day is `fallback`."""
    day, _, hm = (value or "").rpartition("T")
    chosen = day or (fallback.isoformat() if fallback else "")
    parsed = iso_day(chosen)
    # A typed day the form could not read comes back as typed, under "Other date…".
    other = parsed is None and bool(chosen or hm)
    shown = sorted(set(days) | ({parsed} if parsed else set()))
    options = "".join(
        f'<option value="{d.isoformat()}"{" selected" if d == parsed else ""}>'
        f"{day_label(d)}</option>"
        for d in shown
    )
    options += f'<option value="other"{" selected" if other else ""}>Other date…</option>'
    example = shown[-1] if shown else date.today()
    return (
        '<span class="canccu-agenda-when">'
        f'<select class="canccu-input" name={name}_day aria-label="{esc(label)}: day">'
        f"{options}</select>"
        + text_input(
            f"{name}_time",
            hm[:5],
            required=required,
            inputmode="numeric",
            pattern=TIME_PATTERN,
            placeholder="HH:MM",
            maxlength=5,
            **{"aria-label": f"{label}: time, 24-hour"},
        )
        + '<span class="canccu-agenda-when__other">'
        + text_input(
            f"{name}_other",
            chosen if other else "",
            pattern=DATE_PATTERN,
            placeholder=f"{example.day} {example:%b %Y}",
            maxlength=16,
            **{"aria-label": f"{label}: other date, as {example.day} {example:%b %Y}"},
        )
        + "</span></span>"
    )


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


def _parsed(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def event_days(request: Request, today: date, *extra: date | None) -> list[date]:
    """The days a form offers: the event's own and one on each side for setting up and clearing
    away (when it has dates, at most MAX_EVENT_DAYS), today and tomorrow, and the days the form
    already holds. "Other date…" reaches the rest."""
    days = {today, today + timedelta(days=1), *(d for d in extra if d is not None)}
    event = getattr(request.state, "agenda_event", None)
    if event is not None and event.starts_at and event.ends_at:
        tz = zone_of(request)
        first = _parsed(event.starts_at).astimezone(tz).date()
        last = _parsed(event.ends_at).astimezone(tz).date()
        if 0 <= (last - first).days < MAX_EVENT_DAYS:
            days |= {first + timedelta(days=n) for n in range(-1, (last - first).days + 2)}
    return sorted(days)


def event_over(request: Request, now: datetime) -> bool:
    """Whether the event has ended: a cancelled item comes back only until then (sheet 5)."""
    event = getattr(request.state, "agenda_event", None)
    return bool(event is not None and event.ends_at and _parsed(event.ends_at) <= now)


def field(label: str, control: str, hint: str = "") -> str:
    hint_html = f'<span class="canccu-field__hint">{esc(hint)}</span>' if hint else ""
    return (
        f'<label class="canccu-field"><span class="canccu-field__label">{esc(label)}</span>'
        f"{control}{hint_html}</label>"
    )


def check(name: str, label: str, on: bool, hint: str = "") -> str:
    """A checkbox as a row, its hint under it; it posts `1` when ticked and nothing otherwise."""
    hint_html = f'<span class="canccu-field__hint">{esc(hint)}</span>' if hint else ""
    return (
        '<label class="canccu-field canccu-field--check"><input class=canccu-check type=checkbox'
        f' name="{esc(name)}" value=1{" checked" if on else ""}>'
        f'<span class="canccu-field__label">{esc(label)}</span>{hint_html}</label>'
    )


def text_input(name: str, value: Any = "", kind: str = "text", **attrs: Any) -> str:
    extra = "".join(
        f" {k.rstrip('_')}" if v is True else f' {k.rstrip("_")}="{esc(v)}"'
        for k, v in attrs.items()
        if v is not None and v is not False
    )
    return f'<input class="canccu-input" type={kind} name={name} value="{esc(value)}"{extra}>'


def select(name: str, options: list[tuple[str, str]], selected: str | None) -> str:
    opts = "".join(
        f'<option value="{esc(v)}"{" selected" if v == selected else ""}>{esc(label)}</option>'
        for v, label in options
    )
    return f'<select class="canccu-input" name={name}>{opts}</select>'


def hidden(values: dict[str, Any]) -> str:
    return "".join(
        f'<input type=hidden name="{esc(k)}" value="{esc(v)}">'
        for k, value in values.items()
        for v in (value if isinstance(value, list) else [value])
    )


def button(label: str, kind: str = "primary", **attrs: Any) -> str:
    extra = "".join(f' {k}="{esc(v)}"' for k, v in attrs.items())
    return f'<button class="canccu-button canccu-button--{kind}"{extra}>{esc(label)}</button>'


async def static_file(request: Request) -> Response:
    name = request.path_params["name"]
    path = UI_CSS if name == "ui.css" else _STATIC / name
    if name not in (*STYLESHEETS, *SCRIPTS) or not path.is_file():
        raise KitError("not found", status=404, code="not_found")
    kind = "text/javascript" if name in SCRIPTS else "text/css"
    response = FileResponse(path, media_type=kind)
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


ROUTES = [Route("/static/{name}", static_file, methods=["GET"])]
