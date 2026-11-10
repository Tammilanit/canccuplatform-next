"""The frame of the notification pages under admin's "Event" menu: phone-first, server-rendered,
no script (docs/plans/issue-188.md D12, Q4).

Caddy serves the pages under /notify/ and strips the prefix, so routes here are `/admin/topics`,
… while every link a page writes carries `/notify`.
"""

from __future__ import annotations

import html
import os
from pathlib import Path
from typing import Any

from canccu_kit import KitError, MissingRight, check_admin_access, tailscale_cidrs
from canccu_kit.rights import Session
from canccu_kit.web_security import event_page_csp, new_nonce
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from .access import STATS_READ, TOPICS_WRITE, client_ip, tenant_ctx, tenant_of
from .deps import deps

BASE = "/notify"
TOPICS = f"{BASE}/admin/topics"
SIGN_IN = "/admin/sign-in"
_STATIC = Path(__file__).resolve().parent / "static"
# The image sets CANCCU_UI_CSS: an installed package has no packages/ui next to it.
UI_CSS = Path(
    os.environ.get("CANCCU_UI_CSS", Path(__file__).resolve().parents[4] / "packages/ui/ui.css")
)
CHANNEL_LABELS = {"push": "Push", "discord_dm": "Discord DM"}
PART_LABELS = {"event": "Everyone", "personal": "Personal"}


def esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


async def page_session(request: Request) -> Session:
    """The session of a page: `notify.topics.write` to change topics, `notify.stats.read` to see
    the counts; either opens the list. A missing session raises NotSignedIn, which app.py turns
    into the way to sign in."""
    ctx = await tenant_ctx(request)
    session = await deps(request).rights.session(request.headers.get("cookie"))
    request.state.notify_session = session
    if not (session.has(TOPICS_WRITE) or session.has(STATS_READ)):
        raise MissingRight(f"needs right {TOPICS_WRITE} or {STATS_READ}")
    check_admin_access(ctx, client_ip(request), tailscale_cidrs())
    return session


async def writer_session(request: Request) -> Session:
    """A page that changes topics: the write right, on an event that is not archived."""
    session = await page_session(request)
    if not session.has(TOPICS_WRITE):
        raise MissingRight(f"needs right {TOPICS_WRITE}")
    if tenant_of(request)["status"] == "archived":
        raise KitError(
            "the event is archived and its topics read-only", status=409, code="event_archived"
        )
    return session


def page(request: Request, title: str, body: str, *, status: int = 200) -> HTMLResponse:
    nonce = new_nonce()
    session: Session | None = getattr(request.state, "notify_session", None)
    links = [("/agenda/", "Run of show"), (TOPICS, "Notifications")]
    if session is not None and session.has(TOPICS_WRITE):
        links.append((f"{TOPICS}/new", "New topic"))
    links.append(("/admin/", "Admin"))
    menu = "".join(f'<a href="{href}">{esc(label)}</a>' for href, label in links)
    response = HTMLResponse(
        "<!doctype html><html lang=en><meta charset=utf-8>"
        '<meta name=viewport content="width=device-width, initial-scale=1">'
        f"<title>{esc(title)}</title>"
        f'<link rel=stylesheet href="{BASE}/static/ui.css">'
        f'<link rel=stylesheet href="{BASE}/static/notify.css">'
        '<body class="canccu-page canccu-surface canccu-surface--admin">'
        f'<header class="canccu-header"><span class="canccu-header__title">Event</span>'
        f'<nav class="canccu-notify-menu" aria-label="Event">{menu}</nav></header>'
        f'<main class="canccu-main canccu-notify"><h1>{esc(title)}</h1>{body}</main></body></html>',
        status_code=status,
    )
    host = request.url.hostname or "localhost"
    response.headers["Content-Security-Policy"] = event_page_csp(nonce, host, page="admin")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def redirect(path: str) -> RedirectResponse:
    return RedirectResponse(f"{TOPICS}{path}", status_code=303)


def notice(message: str, kind: str = "ok") -> str:
    role = "alert" if kind == "error" else "status"
    classes = f"canccu-notify-notice canccu-notify-notice--{kind}"
    return f'<p class="{classes}" role={role}>{esc(message)}</p>'


def error_page(request: Request, exc: KitError) -> HTMLResponse:
    """A refused change, said in words, with the way back."""
    if exc.code == "version_conflict":
        text = "Someone changed this topic meanwhile. Open it again to see it as it is now."
    else:
        text = exc.message
    body = notice(text, "error") + f'<p><a class=canccu-button href="{TOPICS}">Back</a></p>'
    return page(request, "Not changed", body, status=exc.status)


def field(label: str, control: str, hint: str = "") -> str:
    hint_html = f'<span class="canccu-field__hint">{esc(hint)}</span>' if hint else ""
    return (
        f'<label class="canccu-field"><span class="canccu-field__label">{esc(label)}</span>'
        f"{control}{hint_html}</label>"
    )


def check(name: str, label: str, on: bool, *, disabled: bool = False, hint: str = "") -> str:
    attrs = (" checked" if on else "") + (" disabled" if disabled else "")
    hint_html = f' <span class="canccu-field__hint">{esc(hint)}</span>' if hint else ""
    return (
        f'<label class="canccu-field canccu-field--check"><input class=canccu-check'
        f" type=checkbox name={name}{attrs}> {esc(label)}{hint_html}</label>"
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
        f'<input type=hidden name="{esc(k)}" value="{esc(v)}">' for k, v in values.items()
    )


def button(label: str, kind: str = "primary") -> str:
    return f'<button class="canccu-button canccu-button--{kind}">{esc(label)}</button>'


async def static_file(request: Request) -> Response:
    name = request.path_params["name"]
    path = UI_CSS if name == "ui.css" else _STATIC / name
    if name not in ("ui.css", "notify.css") or not path.is_file():
        raise KitError("not found", status=404, code="not_found")
    response = FileResponse(path, media_type="text/css")
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


ROUTES = [Route("/static/{name}", static_file, methods=["GET"])]
