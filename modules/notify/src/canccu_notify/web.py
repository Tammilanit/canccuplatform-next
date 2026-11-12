"""The frame of the notification pages under admin's "Event" menu: phone-first, server-rendered,
no script (docs/plans/issue-188.md D12, Q4).

Caddy serves the pages under /notify/ and strips the prefix, so routes here are `/admin/topics`,
… while every link a page writes carries `/notify`.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

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

from .access import STATS_READ, TOPICS_WRITE, client_ip, tenant_ctx, tenant_of
from .deps import deps

BASE = "/notify"
TOPICS = f"{BASE}/admin/topics"
SIGN_IN = "/admin/sign-in"
_STATIC = Path(__file__).resolve().parent / "static"
# The image sets CANCCU_UI_CSS; elsewhere packages/ui sits beside this module's source (an
# editable install), while an installed kit has no packages/ui next to it.
UI_CSS = Path(
    os.environ.get("CANCCU_UI_CSS", Path(__file__).resolve().parents[4] / "packages/ui/ui.css")
)
CSS = (f"{BASE}/static/ui.css", f"{BASE}/static/notify.css")
log = logging.getLogger("canccu.notify")
CHANNEL_LABELS = {"push": "Push", "discord_dm": "Discord DM"}
PART_LABELS = {"event": "Everyone", "personal": "Personal"}


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
    request.state.notify_event = await event_of(request)
    return session


async def event_of(request: Request) -> ui.EventInfo | None:
    """The event the shell's header names (canccu_kit.ui)."""
    resolver: TenantResolver | None = getattr(request.app.state, "tenants", None)
    return None if resolver is None else await resolver.event(request.headers.get("host"))


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


def page(
    request: Request,
    title: str,
    body: str,
    *,
    status: int = 200,
    actions: str = "",
    plain: bool = False,
) -> HTMLResponse:
    """A notifications page in the organiser shell; the topic list carries New topic as its
    action, the other pages a way back to it."""
    session: Session | None = getattr(request.state, "notify_session", None)
    crumb = (
        None
        if plain or request.url.path == TOPICS.removeprefix(BASE)
        else (
            TOPICS,
            "Notifications",
        )
    )
    doc = ui.shell_page(
        title,
        body,
        session=session,
        event=getattr(request.state, "notify_event", None),
        current="notify",
        css=CSS,
        crumb=crumb,
        actions=actions,
        narrow=True,
        plain=plain,
    )
    response = HTMLResponse(doc, status_code=status)
    host = request.url.hostname or "localhost"
    response.headers["Content-Security-Policy"] = event_page_csp(new_nonce(), host, page="admin")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def redirect(path: str) -> RedirectResponse:
    return RedirectResponse(f"{TOPICS}{path}", status_code=303)


def notice(message: str, kind: str = "ok") -> str:
    """A notice in the module's words: `ok` or `error`."""
    return ui.notice("down" if kind == "error" else "ok", message)


async def error_page(request: Request, exc: KitError) -> HTMLResponse:
    """A refusal said in words, with the way on (canccu_kit.ui); a missing right goes to the
    log, never to the page (UX audit B3)."""
    if isinstance(exc, MissingRight):
        log.info("page %s refused: %s", request.url.path, exc.message)
    if exc.code == "version_conflict":
        exc = KitError(
            "Someone changed this topic meanwhile. Open it again to see it as it is now.",
            status=exc.status,
            code=exc.code,
        )
    event = getattr(request.state, "notify_event", None) or await event_of(request)
    request.state.notify_event = event
    title, view = ui.error_view(
        exc,
        session=getattr(request.state, "notify_session", None),
        page="Notifications",
        event=event.name if event else None,
        retry=f"{BASE}{request.url.path}",
        back=(TOPICS, "Back to Notifications"),
    )
    return page(request, title, view, status=exc.status, plain=True)


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
