"""The page a scanned check-in QR opens: `/notify/check-in?p=&c=` (Caddy strips `/notify`).

Server-rendered and phone-first (docs/design/mockups.html, sheet 7; #441); check-in.js only adds
what a server cannot know (the phone offline, the camera). Signing in goes straight to Discord
through admin's sign-in and comes back here by its return path (docs/plans/issue-188.md, Q2),
marked `signin=cancelled` when Discord said no. Checking in takes a tap, never a page load: a link
or an image elsewhere must not check anyone in. Checking in is optional (D11).
"""

from __future__ import annotations

from datetime import datetime
from urllib.parse import urlencode

from canccu_kit import KitError, ip_in_cidrs, ui, venue_ip_check_active
from canccu_kit.access import TenantContext
from canccu_kit.web_security import event_page_csp, new_nonce
from starlette.requests import Request
from starlette.responses import HTMLResponse, Response
from starlette.routing import Route

from . import checkin_views as views
from .access import client_ip, session_of, tenant_ctx, tenant_of
from .checkin import (
    ROTATION_DEFAULT,
    CodeExpired,
    CodeInvalid,
    EventArchived,
    NotAMember,
    record,
    valid_code,
    valid_purpose,
)
from .deps import deps
from .web import CSS, event_of

PATH = "/notify/check-in"  # as the browser sees it
PRIVACY = "/notify/privacy"
SCAN_AGAIN = "Scan the screen again to get a fresh code."


async def _page(request: Request, title: str, card: str, *, status: int = 200) -> HTMLResponse:
    """One step of checking in: the event's poster above one card (sheet 7)."""
    doc = ui.front_page(
        title,
        card,
        event=await event_of(request),
        css=CSS,
        centred=True,
        surface="hub",
        privacy=PRIVACY,
    )
    response = HTMLResponse(doc, status_code=status)
    # "sign_in": never framed, so nobody can lay a look-alike over the check-in button.
    host = (request.url.hostname or "").lower()
    response.headers["content-security-policy"] = event_page_csp(new_nonce(), host, page="sign_in")
    # The code in the page is short-lived; a cached copy is useless and should not linger.
    response.headers["cache-control"] = "no-store"
    return response


def _back(purpose: str, code: str) -> str:
    return f"{PATH}?{urlencode({'p': purpose, 'c': code})}"


async def _invalid(request: Request, status: int = 400) -> HTMLResponse:
    text = f"This check-in code is not valid. {SCAN_AGAIN}"
    return await _page(
        request, "Code not valid", views.card("alert", "Code not valid", text), status=status
    )


async def error_page(request: Request, exc: KitError) -> HTMLResponse:
    """Every other refusal, also those of the kit's middleware (the tenants module or admin
    unreachable, a refused origin, a hostname that is no event's): a phone gets the page, never
    the API's JSON body."""
    # The browser's path, not request.url.path: Caddy has stripped `/notify`. A failed tap never
    # gets here with its code (submit says that itself), so a POST has only the bare page.
    retry = f"{PATH}?{request.url.query}" if request.url.query else PATH
    return await _failed(request, retry, exc.status)


async def _failed(request: Request, retry: str, status: int) -> HTMLResponse:
    card = views.failed(retry)
    return await _page(request, "Couldn't check you in", card, status=status)


def _local_time(ctx: TenantContext, iso: str) -> str:
    return ui.time_label(iso, ctx["time_zone"])


async def _closed_or_early(
    request: Request, ctx: TenantContext, now: datetime, status: int
) -> HTMLResponse | None:
    """Before the event, or after it, there is nothing to check in to: say when, or that it has
    closed. The rotating code already proves presence; this keeps an early scan from counting."""
    event = await event_of(request)
    ends = event.ends_at if event else None
    if ctx["status"] == "archived" or (ends and now >= _parse(ends)):
        return await _page(request, "Check-in has closed", views.closed(), status=status)
    starts = event.starts_at if event else None
    if starts and now < _parse(starts):
        card = views.not_open(_parse(starts), ctx["time_zone"])
        return await _page(request, "Check-in is not open yet", card, status=status)
    return None


async def _off_venue(
    request: Request, ctx: TenantContext, now: datetime, retry: str, status: int
) -> HTMLResponse | None:
    """An event with a venue checks in only from the venue's network, unless the venue's
    emergency switch is off (contracts/tenants.md, Venue IP check): the same rule as its screens."""
    venue = ctx["venue"]
    if not venue or not venue["addresses"] or not venue_ip_check_active(ctx, now):
        return None
    if ip_in_cidrs(client_ip(request), venue["addresses"]):
        return None
    hub = deps(request).hub
    wifi = await hub.venue_wifi(_host(request), request.headers.get("cookie")) if hub else []
    ssid = next((w.get("ssid") for w in wifi if w.get("visibility") == "public"), None)
    card = views.off_venue(ssid, retry)
    return await _page(request, "Check in at the venue", card, status=status)


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _host(request: Request) -> str:
    return request.headers.get("host", "")


async def show(request: Request) -> Response:
    ctx = tenant_of(request)
    purpose = valid_purpose(request.query_params.get("p"))
    code = valid_code(request.query_params.get("c"))
    if purpose is None or code is None:
        return await _invalid(request)
    back, now = _back(purpose, code), deps(request).now()
    gate = await _closed_or_early(request, ctx, now, 200) or await _off_venue(
        request, ctx, now, back, 200
    )
    if gate is not None:
        return gate
    session = await session_of(request)
    if session is None:
        cancelled = request.query_params.get("signin") == "cancelled"
        return await _page(request, "Check in", views.sign_in(back, cancelled))
    return await _page(request, "Check in", views.ready(session.user_name, purpose, code))


async def submit(request: Request) -> Response:
    tenant_of(request)
    form = await request.form()
    purpose, code = valid_purpose(form.get("p")), valid_code(form.get("c"))
    if purpose is None or code is None:
        return await _invalid(request)
    back = _back(purpose, code)
    try:
        return await _check_in(request, purpose, code, back)
    except KitError as exc:
        if exc.status < 500:
            raise
        # Try again must come back to this code: the form's p and c are gone once this answers.
        return await _failed(request, back, exc.status)


async def _check_in(request: Request, purpose: str, code: str, back: str) -> Response:
    ctx = await tenant_ctx(request)
    d = deps(request)
    gate = await _closed_or_early(request, ctx, d.now(), 409) or await _off_venue(
        request, ctx, d.now(), back, 403
    )
    if gate is not None:
        return gate
    session = await session_of(request)
    if session is None:
        return await _page(request, "Check in", views.sign_in(back, False), status=401)
    try:
        found, created = await record(d, ctx, session, purpose, code)
    except CodeExpired:
        rotation = int(d.settings.get("check_in_rotation_seconds", ROTATION_DEFAULT))
        return await _page(request, "Code expired", views.expired(rotation), status=400)
    except CodeInvalid:
        return await _invalid(request)
    except EventArchived:
        return await _page(request, "Check-in has closed", views.closed(), status=409)
    except NotAMember:
        # No link: the hub's join page (App track) does not exist yet.
        text = (
            "Only members of this event can check in. Join the event with its join link"
            " from the organisers, then scan the screen again."
        )
        card = views.card("users", "Not a member yet", text)
        return await _page(request, "Not a member yet", card, status=403)
    at = _local_time(ctx, found["checked_in_at"])
    cookie, zone = request.headers.get("cookie"), ctx["time_zone"]
    wifi = await d.hub.venue_wifi(_host(request), cookie) if d.hub else []
    now = await d.hub.agenda_now(_host(request), cookie) if d.hub else None
    if created:
        card = views.done("You're checked in", f"Welcome! Checked in at {at}.", wifi, now, zone)
        return await _page(request, "You're checked in", card, status=201)
    day = ui.day_label(found["checked_in_at"], zone)
    when = f"{at} today" if day == ui.day_label(d.now(), zone) else f"{day}, {at}"
    since = f"Since {when}. Nothing more to do."
    card = views.done("You're already checked in", since, wifi, now, zone)
    return await _page(request, "You're already checked in", card)


async def privacy(request: Request) -> Response:
    """What signing in and checking in keep, until the App track's privacy centre (roadmap,
    step 11) offers export and delete; the facts are the contracts' (tenants.md, Privacy and
    retention; notify.md, Check-in)."""
    tenant_of(request)
    text = (
        "Signing in keeps your Discord account's id, name and username, and when you were last"
        " here. A sign-in ends after 4 hours without use, or after 24 hours."
    )
    more = (
        "<p>Checking in keeps that you arrived and when. It is deleted 30 days after the event"
        " is archived.</p>"
        '<p class="canccu-small canccu-muted">Checking in is optional.</p>'
    )
    card = views.card("lock", "Privacy", text, more, foot="")
    return await _page(request, "Privacy", card)


ROUTES = [
    Route("/check-in", show, methods=["GET"]),
    Route("/check-in", submit, methods=["POST"]),
    Route("/privacy", privacy, methods=["GET"]),
]
