"""The frame of admin's server-rendered pages: packages/ui's organiser shell (canccu_kit.ui)."""

from __future__ import annotations

import logging
import os
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from canccu_kit import KitError, MissingRight, NotSignedIn, TenantResolver
from canccu_kit.rights import Session
from canccu_kit.starlette import page_retry
from canccu_kit.ui import EventInfo, error_view, front_page, menu_for, shell_page
from starlette.requests import Request
from starlette.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    Response,
)

if TYPE_CHECKING:
    from .health import HealthWatch

log = logging.getLogger("canccu.admin")

BASE = "/admin"  # Caddy serves module pages under /admin/ and strips it
CSS = f"{BASE}/static/ui.css"
# What signing in keeps, said on notify's privacy page with what checking in keeps (#441).
PRIVACY = "/notify/privacy"
# The image sets CANCCU_UI_CSS; elsewhere packages/ui sits beside this module's source (an
# editable install), while an installed kit has no packages/ui next to it.
UI_CSS = Path(
    os.environ.get("CANCCU_UI_CSS", Path(__file__).resolve().parents[4] / "packages/ui/ui.css")
)
# Parts of the platform by name, not id (UX audit A2); Health keeps the id in its log column.
PART_NAMES = {
    "admin": "Admin",
    "screen-render": "Screen rendering",
    "agenda": "Run of show",
    "notify": "Notifications",
    "screen": "Screens",
    "theming": "Themes",
    "tenants": "Events",
    "games": "Games",
    "tournament": "Tournament",
    "bot": "Discord",
    "hello": "Test module",
}
SETTINGS_NAMES = {"admin": "General"}
MODULE_ICONS = {
    "admin": "sliders",
    "agenda": "calendar",
    "notify": "bell",
    "screen": "monitor",
    "games": "flag",
}
# Modules whose settings form is a Settings tab on their own page (the admin control room brief,
# direction B, D3): the values and the API stay admin's, only the page moved, and the old address
# opens the tab. The others move in their own step's polish.
SETTINGS_TABS = {"pizza": "/pizza/crew/settings"}
HEALTH_WORDS = {"ok": "Running", "degraded": "Slow", "down": "Down"}
HEALTH_ORDER = {"down": -2, "degraded": -1}  # trouble first
# What a refused page is, for "Your role doesn't include …".
PAGE_NAMES = {
    "settings": "Settings",
    "health-view": "Health",
    "profile": "the event profile",
    "people": "People",
    "access": "Event access",
    "event": "the Event page",
}


def part_name(module: str, *, settings: bool = False) -> str:
    named = SETTINGS_NAMES.get(module) if settings else None
    return named or PART_NAMES.get(module) or module.replace("-", " ").capitalize()


def is_page(request: Request) -> bool:
    path = request.url.path
    return not (path.startswith("/api/") or path.startswith("/internal/"))


async def event_of(request: Request) -> EventInfo | None:
    resolver: TenantResolver | None = getattr(request.app.state, "tenants", None)
    if resolver is None:
        return None
    # The cookie names a draft event to its members; an open event's answer stays shared.
    return await resolver.event(request.headers.get("host"), request.headers.get("cookie"))


async def page(
    request: Request,
    title: str,
    body: str,
    status: int = 200,
    *,
    session: Session | None = None,
    current: str | None = None,
    **shell: Any,
) -> HTMLResponse:
    """A page in the shell; with a session it gets the menu that session may follow."""
    watch: HealthWatch | None = getattr(request.app.state, "health_watch", None)
    # The watch's latest check only: a page never waits for a part that does not answer.
    note = watch.latest.menu_note() if watch and watch.latest else None
    doc = shell_page(
        title,
        body,
        session=session,
        event=await event_of(request),
        current=current,
        css=[CSS],
        menu_notes={"health": note} if note else None,
        **shell,
    )
    return HTMLResponse(doc, status_code=status)


async def front(
    request: Request, title: str, card: str, status: int = 200, **shell: Any
) -> HTMLResponse:
    """A front door (sign-in, first run): the event's poster and one card."""
    doc = front_page(
        title, card, event=await event_of(request), css=[CSS], privacy=PRIVACY, **shell
    )
    return HTMLResponse(doc, status_code=status)


SCRIPTS = Path(__file__).parent / "static"


async def static_script(request: Request) -> Response:
    """Admin's own page scripts, by name from the files beside this module only."""
    path = SCRIPTS / f"{request.path_params['name']}.js"
    if path.parent != SCRIPTS or not path.is_file():
        raise KitError("no such script", status=404, code="not_found")
    response = FileResponse(path, media_type="text/javascript")
    response.headers["Cache-Control"] = "no-cache"  # a changed worker must reach every phone
    response.headers["X-Content-Type-Options"] = "nosniff"
    if path.name == "sw.js":
        # The worker shows the offline page for every module's organiser pages, not only /admin/'s.
        response.headers["Service-Worker-Allowed"] = "/"
    return response


async def static_ui_css(request: Request) -> Response:
    response = FileResponse(UI_CSS, media_type="text/css")
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def page_error_handler(
    read_session: Callable[[str | None], Awaitable[Session]],
) -> Callable[[Request, KitError], Awaitable[Response | None]]:
    """The error page of every admin page path; the API keeps the kit's JSON body (None).
    `read_session` reads a cookie's session as the pages' rights checks do, so the error page
    draws the shell every other page of that session draws."""

    async def page_error(request: Request, exc: KitError) -> Response | None:
        """A page says the refusal in words, in the shell of the session it has, and the right
        it lacked goes to the log only (UX audit B3)."""
        if not is_page(request):
            return None
        if isinstance(exc, MissingRight):
            log.info("page %s refused: %s", request.url.path, exc.message)
        try:
            session = await read_session(request.headers.get("cookie"))
        except KitError:
            session = None
        if isinstance(exc, MissingRight) and session is not None and not session.rights:
            # Without any role "No access" names a page they never asked for; the sign-in page
            # says what to do instead (sheet 3, "No role yet").
            return RedirectResponse(f"{BASE}/sign-in", status_code=303)
        event = await event_of(request)
        section = request.url.path.split("/")[1]
        title, view = error_view(
            exc,
            session=session,
            page=PAGE_NAMES.get(section, "this page"),
            event=event.name if event else None,
            retry=page_retry(request, BASE),
            back=way_back(session, section),
        )
        return await page(request, title, view, exc.status, session=session, plain=True)

    return page_error


def way_back(session: Session | None, section: str) -> tuple[str, str]:
    """Back to the page's own section when the session may open it, else to its first page."""
    if session is None:
        return f"{BASE}/sign-in", "Sign in"
    pages = [i for g in menu_for(session) for i in g["items"]]
    own = next((i for i in pages if i["href"] == f"{BASE}/{section}"), None)
    if own:
        return own["href"], f"Back to {own['label']}"
    if pages:
        return pages[0]["href"], f"Go to {pages[0]['label']}"
    return f"{BASE}/sign-in", "Sign in"


async def not_signed_in(request: Request, exc: Exception) -> Response:
    """The API answers 401 (contracts/admin.md); a page sends the browser to sign in."""
    if request.url.path.startswith("/api/"):
        assert isinstance(exc, NotSignedIn)
        return JSONResponse(exc.to_body(), status_code=exc.status)
    return RedirectResponse(f"{BASE}/sign-in", status_code=303)
