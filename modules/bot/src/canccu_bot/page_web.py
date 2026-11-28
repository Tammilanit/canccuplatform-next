"""The Discord page's frame (#765; B9 of docs/plans/issue-121.md): server-rendered in the organiser
shell at /bot/ (Caddy strips the prefix, so the routes here are `/`, `/channels`, …), a tab bar on
a desktop and one tab menu on a phone, and the words a change comes back with.

Every change is a form that static/discord.js sends to the contract's own API, so the page adds no
way in of its own: who may write, the audit and the events stay where the API keeps them. The
answer comes back as a fixed key (`done`, `error`) this file turns into words: a query parameter
never puts its own words on a page."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from canccu_kit import KitError, MissingRight, NotSignedIn, ui
from canccu_kit.access import TenantContext, check_admin_access, tailscale_cidrs
from canccu_kit.rights import Session
from canccu_kit.starlette import page_retry, sign_in_return
from canccu_kit.ui import esc
from canccu_kit.web_security import event_page_csp, new_nonce
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from .access import client_ip, deps, is_event_admin, tenant_of
from .connection import READ

log = logging.getLogger("canccu_bot.pages")

BASE = "/bot"
SIGN_IN = "/admin/sign-in"
# Admin serves the shared stylesheet (as for the bind's result page); the page's own rules follow.
CSS = ("/admin/static/ui.css", f"{BASE}/static/bot.css")
_STATIC = Path(__file__).resolve().parent / "static"
FILES = {"bot.css": "text/css", "discord.js": "text/javascript"}
SCRIPT = f'<script src="{BASE}/static/discord.js" defer></script>'
TITLE = "Discord"

TABS = (
    ("/", "Overview", "Six cards and what happened"),
    ("/channels", "Channels", "Each purpose's channel or role"),
    ("/commands", "Commands", "The commands per feature"),
    ("/check", "Check", "What the bot needs, and the fixes"),
)
STEPS = (
    ("/setup", "Choose the bot"),
    ("/setup#add", "Add it to your server"),
    ("/channels?setup=1", "Channels and roles"),
    ("/check?setup=1", "Check"),
)

DONE = {
    "bot": "Saved. The bot is the one the event uses now.",
    "picked": "Saved.",
    "created": "Created what could be made. The cards show what is still missing.",
    "checked": "Checked again.",
    "fixed": "Fixed what the bot could fix itself, and checked again.",
    "synced": "The commands are being written to the server again.",
    "switched": "Saved. The server's commands follow in a moment.",
    "unbound": "The server is unbound. The bot serves it no more.",
}
ERRORS = {
    "token_invalid": "Discord refused that token. Copy it again from the Developer Portal.",
    "application_mismatch": "That token belongs to another application than the id you gave.",
    "client_secret_invalid": "Discord refused that client secret. Copy it again from OAuth2.",
    "application_reserved": "That is the platform's own application. Use “The platform's bot”.",
    "application_taken": "Another event uses that application. An admin there clears it first.",
    "guild_bound": "Unbind the server first, then change the bot and add it again.",
    "connection_incomplete": "Your own application needs its bot token and client secret first.",
    "version_conflict": "Someone changed this meanwhile. The page shows it as it is now.",
    "event_archived": "The event is archived, so this can't be changed.",
    "discord_unavailable": "Discord did not answer. Try again in a moment.",
    "discord_not_configured": "This platform has no bot of its own. Use your own application.",
    "discord_refused": "Discord refused the change. The check says what the bot lacks.",
    "target_invalid": "That channel or role is gone from the server. Pick another.",
    "missing_right": "Only an event admin can change this.",
    "not_signed_in": "You were signed out. Sign in again, then try again.",
    "unreachable": "The platform didn't answer. Nothing was changed.",
}
REFUSED = "The platform refused the change. Nothing was changed."


@dataclass
class View:
    """Who is looking at which event: what every part of the page draws from."""

    ctx: TenantContext
    session: Session
    event: ui.EventInfo | None
    admin: bool
    """The event-admin role (access.is_event_admin): the page offers its changes."""

    @property
    def archived(self) -> bool:
        return self.ctx["status"] == "archived"

    @property
    def writes(self) -> bool:
        """A change other than one that deletes data: none on an archived event."""
        return self.admin and not self.archived

    @property
    def zone(self) -> str:
        return self.ctx["time_zone"]

    @property
    def name(self) -> str:
        return self.event.name if self.event and self.event.name else "the event"


async def view_of(request: Request) -> View:
    """The page's reader: `bot.connection.read`, under the event's admin-access rule, as the
    contract's reads. A missing session raises NotSignedIn, which app.py turns into sign-in."""
    ctx = tenant_of(request)
    d = deps(request)
    cookie = request.headers.get("cookie")
    session = await d.rights.session(cookie)
    request.state.bot_session = session
    request.state.bot_event = await d.tenants.event(request.headers.get("host"), cookie)
    if not session.has(READ):
        raise MissingRight(f"needs right {READ}")
    check_admin_access(ctx, client_ip(request), tailscale_cidrs())
    return View(ctx, session, request.state.bot_event, is_event_admin(session))


def form(api: str, method: str, done: str, body: str, *, cls: str = "", confirm: str = "") -> str:
    """A change sent by discord.js to the contract's `api`; then the page at `done`. `body` holds
    the fields and the submit button."""
    ask = f' data-bot-confirm="{esc(confirm)}"' if confirm else ""
    klass = f' class="{cls}"' if cls else ""
    return (
        f'<form{klass} data-bot-api="{esc(api)}" data-bot-method="{method}"'
        f' data-bot-done="{esc(done)}"{ask}>{body}</form>'
    )


def button(label: str, variant: str = "secondary", **attrs: str) -> str:
    extra = "".join(f' {k.replace("_", "-")}="{esc(v)}"' for k, v in attrs.items())
    return f'<button class="canccu-button canccu-button--{variant}"{extra}>{esc(label)}</button>'


def link(href: str, label: str, variant: str = "secondary") -> str:
    return f'<a class="canccu-button canccu-button--{variant}" href="{esc(href)}">{esc(label)}</a>'


def answer_notice(request: Request) -> str:
    """The notice a change came back with: its fixed key in the page's own words."""
    done = DONE.get(request.query_params.get("done", ""))
    if done:
        return ui.notice("ok", done)
    code = request.query_params.get("error")
    if code is None:
        return ""
    return ui.notice("down", "Not changed", ERRORS.get(code, REFUSED))


def here(path: str, setup: bool) -> str:
    return f"{BASE}{path}{'?setup=1' if setup else ''}"


def _tab_menu(current: str) -> str:
    """The phone's one menu for the tabs (mockup 13 C): the open tab and its place, each tab
    with a line of what it holds. A details element, so it opens without a script."""
    index = next(i for i, (p, _, _) in enumerate(TABS) if p == current)
    items = "".join(
        f'<a class="bot-tabmenu__item" href="{BASE}{p}"'
        f"{' aria-current=page' if p == current else ''}>"
        f"<span>{esc(label)}</span><small>{esc(about)}</small></a>"
        for p, label, about in TABS
    )
    return (
        f'<details class="bot-tabmenu"><summary><span>{esc(TABS[index][1])}</span>'
        f"<small>{index + 1} of {len(TABS)}</small></summary>"
        f'<nav aria-label="{TITLE}">{items}</nav></details>'
    )


def steps_bar(step: int) -> str:
    """The guided setup's four steps (mockup 02); the later two open once a server is bound."""
    out = []
    for i, (path, label) in enumerate(STEPS, start=1):
        mark = ' aria-current="step"' if i == step else ""
        out.append(f'<a class="bot-step" href="{BASE}{path}"{mark}>{i} {esc(label)}</a>')
    return f'<nav class="bot-steps" aria-label="Setup">{"".join(out)}</nav>'


def render(
    request: Request,
    view: View | None,
    body: str,
    *,
    description: str,
    tab: str | None = None,
    status: int = 200,
    actions: str = "",
    plain: bool = False,
) -> HTMLResponse:
    """The page in the organiser shell; `tab` is the open tab's path, which draws the tab bar and
    the phone's tab menu. `body` and `actions` are HTML."""
    session = view.session if view else getattr(request.state, "bot_session", None)
    tabs = [(f"{BASE}{p}", label, p == tab) for p, label, _ in TABS] if tab else []
    lead = _tab_menu(tab) if tab else ""
    doc = ui.shell_page(
        TITLE,
        lead + body + SCRIPT,
        session=session,
        event=view.event if view else getattr(request.state, "bot_event", None),
        current="discord",
        css=CSS,
        description_html=esc(description),
        tabs=tabs,
        actions=actions,
        plain=plain,
    )
    response = HTMLResponse(doc, status_code=status)
    host = request.url.hostname or "localhost"
    response.headers["Content-Security-Policy"] = event_page_csp(new_nonce(), host, page="admin")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def to_start() -> RedirectResponse:
    """A tab with no server to show: the page's start, which leads to the setup."""
    return RedirectResponse(f"{BASE}/", status_code=303)


async def not_signed_in(request: Request, exc: Exception) -> Response:
    """The API answers 401 (contracts/bot.md); a page sends the browser to sign in."""
    if request.url.path.startswith("/api/"):
        assert isinstance(exc, NotSignedIn)
        return JSONResponse(exc.to_body(), status_code=exc.status)
    back = sign_in_return(request, BASE, f"{BASE}/")
    return RedirectResponse(f"{SIGN_IN}?{urlencode({'next': back})}", status_code=303)


async def page_error(request: Request, exc: KitError) -> Response | None:
    """A page gets its errors as a page in words; the API keeps the kit's JSON body (None). A
    missing right goes to the log, never to the page (UX audit B3)."""
    if request.url.path.startswith(("/api/", "/internal/")) or request.url.path == "/health":
        return None
    if isinstance(exc, MissingRight):
        log.info("page %s refused: %s", request.url.path, exc.message)
    event = getattr(request.state, "bot_event", None)
    title, body = ui.error_view(
        exc,
        session=getattr(request.state, "bot_session", None),
        page="the Discord page",
        event=event.name if event else None,
        retry=page_retry(request, BASE),
        back=(f"{BASE}/", "Back to Discord"),
    )
    del title
    return render(request, None, body, description="", status=exc.status, plain=True)


async def static_file(request: Request) -> Response:
    name = request.path_params["name"]
    if name not in FILES:
        raise KitError("not found", status=404, code="not_found")
    response = FileResponse(_STATIC / name, media_type=FILES[name])
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def time_words(value: Any, zone: str, today: Any) -> str:
    """ "20:13" today, "Fri 16:20" on another day, in the event's time zone."""
    shown = ui.local_time(value, zone)
    clock = shown.strftime("%H:%M")
    if shown.date() == ui.local_time(today, zone).date():
        return clock
    return f"{shown:%a} {clock}"


ROUTES = [Route("/static/{name}", static_file, methods=["GET"])]
