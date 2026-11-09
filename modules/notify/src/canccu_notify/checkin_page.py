"""The page a scanned check-in QR opens: `/notify/check-in?p=&c=` (Caddy strips `/notify`).

Server-rendered, phone-first and without script. Signing in comes back here through admin's
return path (docs/plans/issue-188.md, Q2). Checking in takes a tap, never a page load: a link or
an image elsewhere must not check anyone in. The page never blocks anything and says what
checking in adds (D11).
"""

from __future__ import annotations

import html
from datetime import datetime
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from canccu_kit.access import TenantContext
from canccu_kit.web_security import event_page_csp, new_nonce
from starlette.requests import Request
from starlette.responses import HTMLResponse, Response
from starlette.routing import Route

from .access import session_of, tenant_ctx, tenant_of
from .checkin import CodeExpired, CodeInvalid, NotAMember, record, valid_code, valid_purpose
from .deps import deps

PATH = "/notify/check-in"  # as the browser sees it
OPTIONAL = (
    "<p class=hint>Checking in is optional. It lets the organisers see that you have arrived;"
    " everything at the event works the same without it.</p>"
)
SCAN_AGAIN = "Scan the screen again to get a fresh code."
# The ui.css token names with their defaults (packages/ui), so an event theme can restyle it.
STYLE = """
body{margin:0;background:var(--canccu-color-background,#0f172a);
color:var(--canccu-color-text,#f8fafc);font:1.1rem/1.5 var(--canccu-font-body,system-ui,sans-serif)}
main{max-width:28rem;margin:0 auto;padding:2rem 1.25rem}
h1{font-size:1.6rem;margin:0 0 1rem}
.hint{color:var(--canccu-color-text-muted,#94a3b8);font-size:.95rem}
.canccu-button{display:block;width:100%;box-sizing:border-box;padding:.9rem;border:0;
border-radius:.5rem;text-align:center;text-decoration:none;font:inherit;font-weight:600;
background:var(--canccu-color-primary,#3b82f6);color:var(--canccu-color-primary-text,#0f172a)}
"""


def _page(request: Request, title: str, body: str, status: int = 200) -> HTMLResponse:
    nonce = new_nonce()
    response = HTMLResponse(
        "<!doctype html><html lang=en><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{html.escape(title)}</title><style nonce='{nonce}'>{STYLE}</style>"
        f"<main><h1>{html.escape(title)}</h1>{body}{OPTIONAL}</main></html>",
        status_code=status,
    )
    # "sign_in": never framed, so nobody can lay a look-alike over the check-in button.
    host = (request.url.hostname or "").lower()
    response.headers["content-security-policy"] = event_page_csp(nonce, host, page="sign_in")
    # The code in the page is short-lived; a cached copy is useless and should not linger.
    response.headers["cache-control"] = "no-store"
    return response


def _sign_in(request: Request, purpose: str, code: str, status: int = 200) -> HTMLResponse:
    back = f"{PATH}?{urlencode({'p': purpose, 'c': code})}"
    href = html.escape(f"/admin/sign-in?{urlencode({'next': back})}")
    return _page(
        request,
        "Sign in to check in",
        f"<p>Sign in once on this phone; you come back here to check in.</p>"
        f'<p><a class=canccu-button href="{href}">Sign in</a></p>',
        status,
    )


def _invalid(request: Request, status: int = 400) -> HTMLResponse:
    body = f"<p>This check-in code is not valid. {SCAN_AGAIN}</p>"
    return _page(request, "Code not valid", body, status)


def _local_time(ctx: TenantContext, iso: str) -> str:
    moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return moment.astimezone(ZoneInfo(ctx["time_zone"])).strftime("%H:%M")


async def show(request: Request) -> Response:
    tenant_of(request)
    purpose = valid_purpose(request.query_params.get("p"))
    code = valid_code(request.query_params.get("c"))
    if purpose is None or code is None:
        return _invalid(request)
    if await session_of(request) is None:
        return _sign_in(request, purpose, code)
    return _page(
        request,
        "Check in",
        f'<form method=post action="{PATH}">'
        f'<input type=hidden name=p value="{html.escape(purpose)}">'
        f'<input type=hidden name=c value="{html.escape(code)}">'
        "<button class=canccu-button>Check in</button></form>",
    )


async def submit(request: Request) -> Response:
    ctx = await tenant_ctx(request)
    form = await request.form()
    purpose, code = valid_purpose(form.get("p")), valid_code(form.get("c"))
    if purpose is None or code is None:
        return _invalid(request)
    session = await session_of(request)
    if session is None:
        return _sign_in(request, purpose, code, 401)
    try:
        found, created = await record(deps(request), ctx, session, purpose, code)
    except CodeExpired:
        return _page(request, "Code expired", f"<p>This code has expired. {SCAN_AGAIN}</p>", 400)
    except CodeInvalid:
        return _invalid(request)
    except NotAMember:
        return _page(
            request,
            "Not a member yet",
            "<p>Only members of this event can check in. Join the event with its own link or"
            " QR code from the organisers, then scan again.</p>",
            403,
        )
    if created:
        return _page(request, "You are checked in", "<p>Welcome!</p>", 201)
    at = _local_time(ctx, found["checked_in_at"])
    return _page(request, "Checked in", f"<p>You were already checked in at {at}.</p>")


ROUTES = [
    Route("/check-in", show, methods=["GET"]),
    Route("/check-in", submit, methods=["POST"]),
]
