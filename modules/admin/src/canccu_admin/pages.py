"""The frame of admin's server-rendered pages: packages/ui's organiser shell (canccu_kit.ui)."""

from __future__ import annotations

import logging
import os
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from canccu_kit import KitError, MissingRight, TenantResolver
from canccu_kit.rights import Session, session_id_from_cookie
from canccu_kit.ui import EventInfo, error_view, front_page, shell_page
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, Response

if TYPE_CHECKING:
    from .auth import Auth

log = logging.getLogger("canccu.admin")

BASE = "/admin"  # Caddy serves module pages under /admin/ and strips it
CSS = f"{BASE}/static/ui.css"
# The image sets CANCCU_UI_CSS; elsewhere packages/ui sits beside this module's source (an
# editable install), while an installed kit has no packages/ui next to it.
UI_CSS = Path(
    os.environ.get("CANCCU_UI_CSS", Path(__file__).resolve().parents[4] / "packages/ui/ui.css")
)
# Parts of the platform by name, not id (UX audit A2); Health keeps the id in its log column.
PART_NAMES = {
    "admin": "Admin",
    "agenda": "Run of show",
    "notify": "Notifications",
    "screen": "Screens",
    "theming": "Themes",
    "tenants": "Events",
    "games": "Games",
    "tournament": "Tournament",
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
HEALTH_WORDS = {"ok": "Running", "degraded": "Slow", "down": "Down"}
HEALTH_ORDER = {"down": -2, "degraded": -1}  # trouble first
# What a refused page is, for "Your role doesn't include …".
PAGE_NAMES = {
    "settings": "Settings",
    "health-view": "Health",
    "profile": "the event profile",
    "people": "People",
}


def part_name(module: str, *, settings: bool = False) -> str:
    named = SETTINGS_NAMES.get(module) if settings else None
    return named or PART_NAMES.get(module) or module.replace("-", " ").capitalize()


def is_page(request: Request) -> bool:
    path = request.url.path
    return not (path.startswith("/api/") or path.startswith("/internal/"))


async def event_of(request: Request) -> EventInfo | None:
    resolver: TenantResolver | None = getattr(request.app.state, "tenants", None)
    return None if resolver is None else await resolver.event(request.headers.get("host"))


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
    doc = shell_page(
        title,
        body,
        session=session,
        event=await event_of(request),
        current=current,
        css=[CSS],
        **shell,
    )
    return HTMLResponse(doc, status_code=status)


async def front(
    request: Request, title: str, card: str, status: int = 200, **shell: Any
) -> HTMLResponse:
    """A front door (sign-in, first run): the event's poster and one card."""
    doc = front_page(title, card, event=await event_of(request), css=[CSS], **shell)
    return HTMLResponse(doc, status_code=status)


async def static_ui_css(request: Request) -> Response:
    response = FileResponse(UI_CSS, media_type="text/css")
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def page_error_handler(auth: Auth) -> Callable[[Request, Exception], Awaitable[Response]]:
    """The KitError handler of every admin path."""

    async def page_error(request: Request, exc: Exception) -> Response:
        """The API keeps its JSON body; a page says the refusal in words, in the shell of the
        session it has, and the right it lacked goes to the log only (UX audit B3)."""
        assert isinstance(exc, KitError)
        if not is_page(request):
            return JSONResponse(exc.to_body(), status_code=exc.status)
        if isinstance(exc, MissingRight):
            log.info("page %s refused: %s", request.url.path, exc.message)
        try:
            session = await auth.session(session_id_from_cookie(request.headers.get("cookie")))
        except KitError:
            session = None
        event = await event_of(request)
        title, view = error_view(
            exc,
            session=session,
            page=PAGE_NAMES.get(request.url.path.split("/")[1], "this page"),
            event=event.name if event else None,
            retry=f"{BASE}{request.url.path}",
            back=(f"{BASE}/settings", "Back to Settings"),
        )
        return await page(request, title, view, exc.status, session=session, plain=True)

    return page_error
