"""The event's front door: its base address `/`, which Caddy hands to notify unchanged (#750).

The sign-in front page's poster in the hub's look, and one card: what is on now and next, the
public pages that are on, and a way in for the crew. Notify serves it as the hub's module (App
track), and the hub grows from here. What a guest sees follows the info-page mode; a draft shows
guests nothing but that it is not open (contracts/tenants.md, Info-page mode, Lifecycle).
"""

from __future__ import annotations

from canccu_kit import AdminUnavailable, InfoPagesClosed, KitError, check_info_access, ui
from canccu_kit.access import TenantContext
from canccu_kit.rights import Session
from canccu_kit.web_security import event_page_csp, new_nonce
from starlette.requests import Request
from starlette.responses import HTMLResponse, Response
from starlette.routing import Route

from . import front_door_views as views
from .access import client_ip, is_member, session_of, tenant_of
from .deps import deps
from .web import CSS, event_of

PRIVACY = "/notify/privacy"


def _page(
    request: Request, title: str, card: str, event: ui.EventInfo | None, status: int
) -> HTMLResponse:
    doc = ui.front_page(title, card, event=event, css=CSS, surface="hub", privacy=PRIVACY)
    response = HTMLResponse(doc, status_code=status)
    # As the check-in's: never framed, so nobody lays a look-alike over its way in.
    host = (request.url.hostname or "").lower()
    response.headers["content-security-policy"] = event_page_csp(new_nonce(), host, page="sign_in")
    # Now and next move, and a session changes the page: a cached copy would be stale or another's.
    response.headers["cache-control"] = "no-store"
    return response


async def _session(request: Request) -> Session | None:
    """A public page outlives admin: with admin down the visitor reads it as a guest."""
    try:
        return await session_of(request)
    except AdminUnavailable:
        return None


def _visible(request: Request, ctx: TenantContext, member: bool) -> bool:
    try:
        check_info_access(ctx, client_ip=client_ip(request), viewer="member" if member else "guest")
    except InfoPagesClosed:
        return False
    return True


async def _card(request: Request, ctx: TenantContext, session: Session | None) -> str:
    member = session is not None and is_member(session.user_id)
    if ctx["status"] == "draft" and not member:
        return views.not_open()
    if not _visible(request, ctx, member):
        return views.closed(ctx["info_page_mode"])
    parts = [views.draft_notice()] if ctx["status"] == "draft" else []
    if ctx["status"] == "archived":
        parts.append(views.ended())
    else:
        d = deps(request)
        now = None
        if d.hub:
            host = request.headers.get("host", "")
            now = await d.hub.agenda_now(host, request.headers.get("cookie"), client_ip(request))
        parts += [views.whats_on(), views.now_next(now, ctx["time_zone"], d.now())]
    parts.append(views.links(ctx["flags"]))
    return "".join(parts)


async def show(request: Request) -> Response:
    ctx = tenant_of(request)
    session = await _session(request)
    card = await _card(request, ctx, session) + views.crew(session is not None)
    event = await event_of(request)
    # Tenants names a draft only to its members; a guest's nameless poster would stand empty, so
    # the platform's stands in, as on a front door no event claims (#708).
    poster = event if event is not None and event.name else None
    return _page(request, "Welcome", card, poster, 200)


async def error_page(request: Request, exc: KitError) -> HTMLResponse:
    """A hostname no event claims, or the tenants module not answering: still a page, never the
    API's JSON body."""
    if exc.status == 404:
        card = views.no_event() + views.crew(False)
        return _page(request, "No event here", card, None, 404)
    return _page(request, "Couldn't load the event", views.failed(), None, exc.status)


ROUTES = [Route("/", show, methods=["GET"])]
