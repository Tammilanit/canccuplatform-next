"""The admin home (#782 part B, plan D6): the event at a glance with a link to its Event page, its
screens with each zone's live view, and the pages the person may open. The PO asked for the screens
"already on the front page of /admin" (2026-11-23); #744's control center later replaces this page.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any

from canccu_kit import KitError, TenantResolver
from canccu_kit.rights import Session
from canccu_kit.ui import EventInfo, date_range, esc, icon, menu_for, notice
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

from .event_owners import ScreenApi, TenantsApi
from .pages import BASE, event_of, page
from .zones import zone_label

EVENT_PAGE = f"{BASE}/event"
STUDIO = f"{BASE}/screen/"
PAIR = f"{BASE}/screen/devices#pair="
EVENT_RIGHTS = ("tenants.event.write", "admin.settings.read")
DESCRIPTION = "Where to start: the event at a glance, its screens and every page your role opens."
# A line under each page's name, in the reader's words.
ABOUT = {
    "agenda": "The event's schedule, as attendees and the screens show it.",
    "notify": "What attendees can be notified about.",
    "announce": "Messages that pop up on the screens and phones.",
    "food": "The day's food orders, pizzerias and menus.",
    "screen": "Zones, screens, the ticker and what plays.",
    "theme": "The event's colours, fonts and logo.",
    "settings": "Each part's settings and event access.",
    "health": "Whether every part of the platform is running.",
    "profile": "Load or save the whole event as one file.",
    "people": "Who has a role in the event.",
    "integrations": "Keys for outside services, such as the Food AI reader.",
}


def _row(href: str, ico: str, title: str, about: str, *, external: bool = False) -> str:
    target = ' target="_blank" rel="noopener"' if external else ""
    return (
        f'<a class="canccu-list__row" href="{esc(href)}"{target}>'
        f'<span class="canccu-list__icon">{icon(ico)}</span>'
        f'<span class="canccu-list__main"><p class="canccu-list__title">{esc(title)}</p>'
        f'<p class="canccu-list__meta">{esc(about)}</p></span>'
        f'<span class="canccu-list__end">{icon("right")}</span></a>'
    )


def _section(title: str, body: str) -> str:
    return (
        f'<section class="canccu-card canccu-card--flush"><h2 class="canccu-card__title">'
        f"{esc(title)}</h2>{body}</section>"
    )


def _event(event: Mapping[str, Any]) -> str:
    zone = str(event.get("time_zone") or "UTC")
    info = EventInfo(
        name=event.get("name"),
        status=str(event.get("status") or "live"),
        time_zone=zone,
        starts_at=event.get("starts_at"),
        ends_at=event.get("ends_at"),
    )
    when = date_range(info) or "No dates yet"
    about = f"{when} · {zone_label(zone)}"
    row = _row(EVENT_PAGE, "box", f"{info.name or 'The event'}: details", about)
    return _section("Event", f'<div class="canccu-list">{row}</div>')


def _screens(session: Session, zones: Sequence[tuple[str, str]] | None) -> str:
    rows = [
        _row(f"/screen/zones/{key}", "monitor", name, "Open the live view", external=True)
        for key, name in zones or ()
    ]
    rows.append(_row(STUDIO, "sliders", "Screen studio", "Zones, screens and what they play."))
    if session.has("screen.devices.pair"):
        rows.append(_row(PAIR, "plus", "Pair a screen", "Connect a new screen with its code."))
    if zones is None:
        warn = notice("warn", "Screens didn't answer.", "Open the Screen studio.")
    elif not zones:
        warn = notice("info", "No zones yet.", "Add one in the Screen studio.")
    else:
        warn = ""
    return _section("Screens", f'{warn}<div class="canccu-list">{"".join(rows)}</div>')


def _pages(session: Session) -> str:
    rows = [
        _row(item["href"], item["icon"], item["label"], ABOUT.get(item["id"], ""))
        for group in menu_for(session)
        for item in group["items"]
        if item["id"] != "home"
    ]
    return _section("Your pages", f'<div class="canccu-list">{"".join(rows)}</div>')


def may_see_screens(session: Session) -> bool:
    return any(i["id"] == "screen" for g in menu_for(session) for i in g["items"])


def home_view(
    session: Session,
    event: Mapping[str, Any] | None,
    zones: Sequence[tuple[str, str]] | None,
) -> str:
    """The home's sections this session may follow; `zones` None when Screen did not answer."""
    parts = []
    if event is not None and any(session.has(r) for r in EVENT_RIGHTS):
        parts.append(_event(event))
    if may_see_screens(session):
        parts.append(_screens(session, zones))
    parts.append(_pages(session))
    return "".join(parts)


async def tenant_id_of(request: Any) -> str | None:
    """The request's event, when its hostname is one: `/admin/` is not a tenant path, as the
    sign-in hostname serves it too (tenancy.py)."""
    resolver: TenantResolver | None = getattr(request.app.state, "tenants", None)
    if resolver is None:
        return None
    try:
        found = await resolver.resolve(request.headers.get("host"))
    except KitError:
        return None
    return found.context["tenant_id"] if found.context is not None else None


async def home_page(
    request: Any,
    session: Session,
    tenants: TenantsApi | None,
    screen: ScreenApi | None,
) -> Any:
    event: Mapping[str, Any] | None = None
    if any(session.has(r) for r in EVENT_RIGHTS):
        event = await tenants.read(request) if tenants else None
        if event is None:  # tenants' answer for everyone, as the shell's header has it
            known = await event_of(request)
            event = vars(known) if known else None
    zones = None
    if may_see_screens(session) and screen is not None:
        tenant = await tenant_id_of(request)
        zones = None if tenant is None else await screen.zones(tenant)
    return await page(
        request,
        "Home",
        home_view(session, event, zones),
        session=session,
        current="home",
        description_html=esc(DESCRIPTION),
    )


def home_route(
    read_session: Callable[[str | None], Awaitable[Session]],
    tenants: TenantsApi | None,
    screen: ScreenApi | None,
) -> Callable[[Request], Awaitable[Response]]:
    async def index(request: Request) -> Response:
        """Home for anyone with a role; without one, "No role yet" on sign-in."""
        session = await read_session(request.headers.get("cookie"))
        if not menu_for(session):
            return RedirectResponse(f"{BASE}/sign-in", status_code=303)
        home: Response = await home_page(request, session, tenants, screen)
        return home

    return index
