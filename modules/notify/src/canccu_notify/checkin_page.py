"""The page a scanned check-in QR opens: `/notify/check-in?p=&c=` (Caddy strips `/notify`).

Server-rendered, phone-first and without script. Signing in comes back here through admin's
return path (docs/plans/issue-188.md, Q2). Checking in takes a tap, never a page load: a link or
an image elsewhere must not check anyone in. The page never blocks anything and says what
checking in adds (D11).
"""

from __future__ import annotations

from datetime import datetime
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from canccu_kit import KitError, ui
from canccu_kit.access import TenantContext
from canccu_kit.web_security import event_page_csp, new_nonce
from starlette.requests import Request
from starlette.responses import HTMLResponse, Response
from starlette.routing import Route

from .access import session_of, tenant_ctx, tenant_of
from .checkin import (
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
OPTIONAL = (
    '<p class="canccu-small canccu-muted">Checking in is optional. It lets the organisers see'
    " that you have arrived; everything at the event works the same without it.</p>"
)
SCAN_AGAIN = "Scan the screen again to get a fresh code."


async def _page(
    request: Request,
    title: str,
    text: str,
    action: str = "",
    *,
    icon: str = "pin",
    status: int = 200,
) -> HTMLResponse:
    """One step of checking in: the event's poster above one card with an icon, a title, a
    sentence and the next step (docs/design/mockups.html, sheet 7)."""
    card = (
        f'<span class="canccu-task__icon">{ui.icon(icon)}</span><h1>{ui.esc(title)}</h1>'
        f"<p>{ui.esc(text)}</p>{action}{OPTIONAL}"
    )
    doc = ui.front_page(
        title, card, event=await event_of(request), css=CSS, centred=True, surface="hub"
    )
    response = HTMLResponse(doc, status_code=status)
    # "sign_in": never framed, so nobody can lay a look-alike over the check-in button.
    host = (request.url.hostname or "").lower()
    response.headers["content-security-policy"] = event_page_csp(new_nonce(), host, page="sign_in")
    # The code in the page is short-lived; a cached copy is useless and should not linger.
    response.headers["cache-control"] = "no-store"
    return response


def _button(label: str, ico: str = "") -> str:
    icon = ui.icon(ico) if ico else ""
    cls = "canccu-button canccu-button--primary canccu-button--lg"
    return f'<button class="{cls}">{icon}{label}</button>'


async def _sign_in(request: Request, purpose: str, code: str, status: int = 200) -> HTMLResponse:
    back = f"{PATH}?{urlencode({'p': purpose, 'c': code})}"
    href = ui.esc(f"/admin/sign-in?{urlencode({'next': back})}")
    link = (
        f'<a class="canccu-button canccu-button--primary canccu-button--lg" href="{href}">'
        "Continue with Discord</a>"
    )
    text = (
        "Tell the crew you have arrived. You sign in with Discord once on this phone and come"
        " back here; if the code has expired by then, scan the screen again."
    )
    return await _page(request, "Check in", text, link, status=status)


async def _invalid(request: Request, status: int = 400) -> HTMLResponse:
    text = f"This check-in code is not valid. {SCAN_AGAIN}"
    return await _page(request, "Code not valid", text, icon="alert", status=status)


async def error_page(request: Request, exc: KitError) -> HTMLResponse:
    """Every other refusal, also those of the kit's middleware (the tenants module or admin
    unreachable, a refused origin, a hostname that is no event's): a phone gets the page, never
    the API's JSON body."""
    text = (
        "Checking in did not work this time. Try again in a moment; if the code has expired"
        " by then, scan the screen again."
    )
    return await _page(request, "Check-in not available", text, icon="alert", status=exc.status)


def _local_time(ctx: TenantContext, iso: str) -> str:
    moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return moment.astimezone(ZoneInfo(ctx["time_zone"])).strftime("%H:%M")


async def show(request: Request) -> Response:
    tenant_of(request)
    purpose = valid_purpose(request.query_params.get("p"))
    code = valid_code(request.query_params.get("c"))
    if purpose is None or code is None:
        return await _invalid(request)
    session = await session_of(request)
    if session is None:
        return await _sign_in(request, purpose, code)
    form = (
        f'<form method=post action="{PATH}">'
        f'<input type=hidden name=p value="{ui.esc(purpose)}">'
        f'<input type=hidden name=c value="{ui.esc(code)}">{_button("Check in", "check")}</form>'
    )
    text = f"You're signed in as {session.user_name}. One tap and the crew knows you're here."
    return await _page(request, "Check in", text, form)


async def submit(request: Request) -> Response:
    ctx = await tenant_ctx(request)
    form = await request.form()
    purpose, code = valid_purpose(form.get("p")), valid_code(form.get("c"))
    if purpose is None or code is None:
        return await _invalid(request)
    session = await session_of(request)
    if session is None:
        return await _sign_in(request, purpose, code, 401)
    try:
        found, created = await record(deps(request), ctx, session, purpose, code)
    except CodeExpired:
        text = f"This code has expired. {SCAN_AGAIN}"
        return await _page(request, "Code expired", text, icon="clock", status=400)
    except CodeInvalid:
        return await _invalid(request)
    except EventArchived:
        text = "This event has ended. Nothing more to do here."
        return await _page(request, "Event ended", text, icon="archive", status=409)
    except NotAMember:
        # No link: the hub's join page (App track) does not exist yet.
        text = (
            "Only members of this event can check in. Join the event with its join link"
            " from the organisers, then scan the screen again."
        )
        return await _page(request, "Not a member yet", text, icon="users", status=403)
    at = _local_time(ctx, found["checked_in_at"])
    if created:
        text = f"Welcome! Checked in at {at}."
        return await _page(request, "You're checked in", text, icon="check-circle", status=201)
    text = f"You were already checked in at {at}. Nothing more to do."
    return await _page(request, "You're already checked in", text, icon="check-circle")


ROUTES = [
    Route("/check-in", show, methods=["GET"]),
    Route("/check-in", submit, methods=["POST"]),
]
