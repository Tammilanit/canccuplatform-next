"""Sign-in HTTP surface: the session API (contracts/admin.md) and the sign-in pages."""

from __future__ import annotations

import html
from collections.abc import Awaitable, Callable

from canccu_kit import Event, KitError, NotSignedIn, error_body
from canccu_kit.rights import SESSION_COOKIE, Session, session_id_from_cookie
from canccu_kit.ui import notice
from canccu_kit.web_security import SAFE_METHODS
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp, Receive, Scope, Send

from . import sign_in_views as views
from .auth import ABSOLUTE, FLOW_LIFETIME, Auth, safe_return_path
from .pages import BASE, event_of, front, page

Authorize = Callable[[str | None, str], Awaitable[Session]]
# The request's session when it holds the right (app.create_app's `need`); refuses otherwise.
Need = Callable[[Request, str], Awaitable[Session]]
OnEvent = Callable[[Event], Awaitable[None]]
Viewer = Callable[[str | None], Awaitable[Session]]
FLOW_COOKIE = "canccu_sign_in"
FLOW_PATH = f"{BASE}/sign-in"
CALLBACK_PATH = f"{FLOW_PATH}/callback"  # the redirect URI registered with Discord


class OriginCheck:
    """Refuses a state-changing page request whose Origin is not the public URL's (CSRF).

    SameSite=Lax already keeps the session cookie off cross-site POSTs; this also covers
    same-site neighbours. A request without Origin passes. The API keeps to its contract's
    error codes, so it relies on SameSite alone until the contract names `bad_origin`.
    """

    def __init__(self, app: ASGIApp, origin: str | None) -> None:
        self.app = app
        self.origin = origin

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and self.origin
            and scope["method"] not in SAFE_METHODS
            and not scope["path"].startswith("/api/")
        ):
            sent = dict(scope["headers"]).get(b"origin")
            if sent is not None and sent.decode("latin-1") != self.origin:
                body = error_body("bad_origin", "request from another site refused")
                await JSONResponse(body, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def auth_routes(
    auth: Auth, authorize: Authorize, on_event: OnEvent | None, viewer: Viewer | None
) -> list[Route]:
    def session_id(request: Request) -> str | None:
        return session_id_from_cookie(request.headers.get("cookie"))

    def clear_session(response: Response) -> Response:
        response.delete_cookie(
            SESSION_COOKIE, path="/", secure=auth.secure_cookies, httponly=True, samesite="lax"
        )
        return response

    async def failed(request: Request, exc: KitError) -> Response:
        """The sign-in page again, with what went wrong said above its button."""
        warning = notice("warn", "Sign-in didn't finish", exc.message)
        return await sign_in_card(request, warning, exc.status)

    async def sign_in_card(request: Request, warning: str = "", status: int = 200) -> Response:
        back = safe_return_path(request.query_params.get("next"))
        hidden = f'<input type=hidden name=next value="{html.escape(back)}">' if back else ""
        event = await event_of(request)
        card = views.sign_in_card(
            archived=event is not None and event.status == "archived",
            ready=auth.discord is not None,
            warning=warning,
            hidden=hidden,
        )
        if not await auth.store.has_owner():
            card += (
                f'<p class="canccu-small">First start? <a href="{BASE}/first-run">'
                "Use the first-run code</a>.</p>"
            )
        return await front(request, "Sign in", card, status)

    async def to_discord(claim_hash: str | None, return_path: str | None = None) -> Response:
        url, nonce = await auth.start(claim_hash, return_path)
        response = RedirectResponse(url, status_code=303)
        response.set_cookie(
            FLOW_COOKIE,
            nonce,
            max_age=int(FLOW_LIFETIME.total_seconds()),
            path=FLOW_PATH,
            secure=auth.secure_cookies,
            httponly=True,
            samesite="lax",  # Lax still sends it on Discord's top-level redirect back
        )
        return response

    # --- API
    async def get_session(request: Request) -> Response:
        return JSONResponse(await auth.session_body(session_id(request)))

    async def sign_out_api(request: Request) -> Response:
        await auth.sign_out(session_id(request))
        return clear_session(Response(status_code=204))

    # --- pages
    async def sign_in_page(request: Request) -> Response:
        """The card for the browser's state: signed in (on to the pages, or "No role yet"), a
        session that ended by itself ("You were signed out"), or none (Discord's button)."""
        back = safe_return_path(request.query_params.get("next"))
        sid = session_id(request)
        if sid is None:
            return await sign_in_card(request)
        try:
            session = await auth.session(sid)
        except NotSignedIn:
            view = views.signed_out_view(back)
            return clear_session(await page(request, "Signed out", view, plain=True))
        if back or session.rights:
            return RedirectResponse(back or f"{BASE}/", status_code=303)
        event = await event_of(request)
        card = views.no_role_card(session.user_name, event.name if event else None)
        return await front(request, "No role yet", card)

    async def sign_in_start(request: Request) -> Response:
        back = (await request.form()).get("next")
        try:
            return await to_discord(None, back if isinstance(back, str) else None)
        except KitError as exc:
            return await failed(request, exc)

    def clear_flow(response: Response) -> Response:
        # The flow is used up whatever the outcome; its nonce has no further use.
        response.delete_cookie(
            FLOW_COOKIE, path=FLOW_PATH, secure=auth.secure_cookies, httponly=True, samesite="lax"
        )
        return response

    async def callback(request: Request) -> Response:
        query = request.query_params
        if "error" in query:
            back = await auth.cancelled(query.get("state", ""), request.cookies.get(FLOW_COOKIE))
            if back:
                path, _, fragment = back.partition("#")
                marked = f"{path}{'&' if '?' in path else '?'}signin=cancelled"
                marked += f"#{fragment}" if fragment else ""
                return clear_flow(RedirectResponse(marked, status_code=303))
            cancelled = KitError(
                "Discord was closed before it said yes. Nothing was changed.",
                status=400,
                code="sign_in_cancelled",
            )
            return clear_flow(await failed(request, cancelled))
        try:
            token, _, back = await auth.finish(
                query.get("state", ""),
                request.cookies.get(FLOW_COOKIE),
                query.get("code", ""),
                session_id(request),
            )
        except KitError as exc:
            return clear_flow(await failed(request, exc))
        response = clear_flow(RedirectResponse(back or f"{BASE}/", status_code=303))
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=int(ABSOLUTE.total_seconds()),
            path="/",
            secure=auth.secure_cookies,
            httponly=True,
            samesite="lax",
        )
        return response

    async def first_run_page(request: Request) -> Response:
        return await first_run_card(request)

    async def first_run_card(request: Request, warning: str = "", status: int = 200) -> Response:
        if await auth.store.has_owner():
            card = (
                "<h1>This platform has an owner</h1>"
                f'<a class="canccu-button canccu-button--primary canccu-button--lg '
                f'canccu-button--block" href="{BASE}/sign-in">Sign in</a>'
            )
        else:
            card = (
                '<p class="canccu-overline">First start</p><h1>Become the owner</h1>'
                + (
                    warning
                    or '<p class="canccu-muted">Enter the first-run code from admin\'s log, then'
                    " sign in with Discord: that Discord account becomes the owner.</p>"
                )
                + '<form method=post><div class="canccu-field"><label class="canccu-field__label"'
                ' for="canccu-field-code">First-run code</label><input class="canccu-input"'
                ' id="canccu-field-code" name=code autocomplete=off required></div>'
                '<button class="canccu-button canccu-button--primary canccu-button--lg '
                'canccu-button--block">Continue with Discord</button></form>'
            )
        return await front(request, "First run", card, status)

    async def first_run_start(request: Request) -> Response:
        form = await request.form()
        try:
            claim = await auth.check_first_run_code(str(form.get("code", "")))
            return await to_discord(claim)
        except KitError as exc:
            warning = notice("warn", "That didn't work", exc.message)
            return await first_run_card(request, warning, exc.status)

    async def sign_out_page(request: Request) -> Response:
        await auth.sign_out(session_id(request))
        response = clear_session(RedirectResponse(f"{BASE}/sign-in", status_code=303))
        # The service worker's offline page holds this person's menu (static/sw.js).
        response.headers["Clear-Site-Data"] = '"cache"'
        return response

    async def offline_page(request: Request) -> Response:
        try:
            cookie = request.headers.get("cookie")
            session: Session | None = await (
                viewer(cookie) if viewer else auth.session(session_id_from_cookie(cookie))
            )
        except NotSignedIn:
            session = None
        view = views.offline_view()
        return await page(request, "You're offline", view, session=session, plain=True)

    return [
        Route("/api/admin/session", get_session, methods=["GET"]),
        Route("/api/admin/session/sign-out", sign_out_api, methods=["POST"]),
        Route("/sign-in", sign_in_page, methods=["GET"]),
        Route("/sign-in", sign_in_start, methods=["POST"]),
        Route("/sign-in/callback", callback, methods=["GET"]),
        Route("/first-run", first_run_page, methods=["GET"]),
        Route("/first-run", first_run_start, methods=["POST"]),
        Route("/sign-out", sign_out_page, methods=["POST"]),
        Route("/offline", offline_page, methods=["GET"]),
    ]
