"""The frame of the run-of-show pages: phone-first, server-rendered, no script (plan issue-187 D8).

Caddy serves the pages under /agenda/ and strips the prefix, so routes here are `/`, `/add`, …
while every link a page writes carries `/agenda`.
"""

from __future__ import annotations

import html
import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from canccu_kit import KitError, MissingRight, check_admin_access, tailscale_cidrs
from canccu_kit.rights import Session
from canccu_kit.web_security import event_page_csp, new_nonce
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from .access import CREW_READ, WRITE, tenant_of
from .deps import deps

BASE = "/agenda"
SIGN_IN = "/admin/sign-in"
_STATIC = Path(__file__).resolve().parent / "static"
# The image sets CANCCU_UI_CSS: an installed package has no packages/ui next to it.
UI_CSS = Path(
    os.environ.get("CANCCU_UI_CSS", Path(__file__).resolve().parents[4] / "packages/ui/ui.css")
)
MENU = (("/", "Run of show"), ("/add", "Quick add"), ("/templates", "Templates"))
VISIBILITY_LABELS = {"public": "Everyone", "attendees": "Attendees", "crew": "Crew only"}
CHANNEL_LABELS = {
    "screen": "Screen notice",
    "discord_channel": "Discord channel",
    "discord_dm": "Discord DM",
    "push": "Push",
}


def esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


async def page_session(request: Request) -> Session:
    """The session of a page: the run-of-show is for organisers and crew (plan D9). A missing
    session raises NotSignedIn, which app.py turns into the way to sign in."""
    ctx = tenant_of(request)
    session = await deps(request).rights.session(request.headers.get("cookie"))
    request.state.agenda_session = session
    if not (session.has(WRITE) or session.has(CREW_READ)):
        raise MissingRight(f"needs right {WRITE} or {CREW_READ}")
    check_admin_access(ctx, request.client.host if request.client else None, tailscale_cidrs())
    return session


def page(
    request: Request, title: str, body: str, *, status: int = 200, session: Session | None = None
) -> HTMLResponse:
    nonce = new_nonce()
    # The session a page's check already read (access.remember); without one, as on an error
    # page, only the links every reader may follow.
    session = session or getattr(request.state, "agenda_session", None)
    links = MENU if session is not None and session.has(WRITE) else MENU[:1]
    menu = "".join(f'<a href="{BASE}{path}">{esc(label)}</a>' for path, label in links)
    menu += '<a href="/admin/">Admin</a>'
    response = HTMLResponse(
        "<!doctype html><html lang=en><meta charset=utf-8>"
        '<meta name=viewport content="width=device-width, initial-scale=1">'
        f"<title>{esc(title)}</title>"
        f'<link rel=stylesheet href="{BASE}/static/ui.css">'
        f'<link rel=stylesheet href="{BASE}/static/agenda.css">'
        '<body class="canccu-page canccu-surface canccu-surface--admin">'
        f'<header class="canccu-header"><span class="canccu-header__title">Event</span>'
        f'<nav class="canccu-agenda-menu" aria-label="Event">{menu}</nav></header>'
        f'<main class="canccu-main canccu-agenda"><h1>{esc(title)}</h1>{body}</main></body></html>',
        status_code=status,
    )
    host = request.url.hostname or "localhost"
    response.headers["Content-Security-Policy"] = event_page_csp(nonce, host, page="admin")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def redirect(path: str) -> RedirectResponse:
    return RedirectResponse(f"{BASE}{path}", status_code=303)


def notice(message: str, kind: str = "ok") -> str:
    role = "alert" if kind == "error" else "status"
    classes = f"canccu-agenda-notice canccu-agenda-notice--{kind}"
    return f'<p class="{classes}" role={role}>{esc(message)}</p>'


def error_page(request: Request, exc: KitError) -> HTMLResponse:
    """A refused change, said in words, with the way back."""
    if exc.code == "version_conflict":
        text = "Someone changed this item meanwhile. Open it again to see it as it is now."
    else:
        text = exc.message
    body = notice(text, "error") + f'<p><a class=canccu-button href="{BASE}/">Back</a></p>'
    return page(request, "Not changed", body, status=exc.status)


def zone_of(request: Request) -> ZoneInfo:
    """The event's time zone: every time a page shows or reads is in it."""
    try:
        return ZoneInfo(tenant_of(request)["time_zone"])
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def hhmm(value: datetime | str | None, tz: ZoneInfo) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.astimezone(tz).strftime("%H:%M")


def day_label(day: date) -> str:
    return f"{day:%a} {day.day} {day:%b}"


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


def field(label: str, control: str, hint: str = "") -> str:
    hint_html = f'<span class="canccu-field__hint">{esc(hint)}</span>' if hint else ""
    return (
        f'<label class="canccu-field"><span class="canccu-field__label">{esc(label)}</span>'
        f"{control}{hint_html}</label>"
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
    if name not in ("ui.css", "agenda.css") or not path.is_file():
        raise KitError("not found", status=404, code="not_found")
    response = FileResponse(path, media_type="text/css")
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


ROUTES = [Route("/static/{name}", static_file, methods=["GET"])]
