"""The frame of admin's server-rendered pages: packages/ui's organiser shell (canccu_kit.ui)."""

from __future__ import annotations

from typing import Any

from canccu_kit import TenantResolver
from canccu_kit.rights import Session
from canccu_kit.ui import UI_CSS, EventInfo, front_page, shell_page
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, Response

BASE = "/admin"  # Caddy serves module pages under /admin/ and strips it
CSS = f"{BASE}/static/ui.css"
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
