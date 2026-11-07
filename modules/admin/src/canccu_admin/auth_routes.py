"""Sign-in HTTP surface: the session API (contracts/admin.md) and the sign-in pages."""

from __future__ import annotations

import html
from collections.abc import Awaitable, Callable

from canccu_kit import Event, KitError, error_body
from canccu_kit.rights import SESSION_COOKIE, Session, session_id_from_cookie
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp, Receive, Scope, Send

from .auth import ABSOLUTE, FLOW_LIFETIME, Auth
from .pages import BASE, page

Authorize = Callable[[str | None, str], Awaitable[Session]]
OnEvent = Callable[[Event], Awaitable[None]]
FLOW_COOKIE = "canccu_sign_in"
FLOW_PATH = f"{BASE}/sign-in"
CALLBACK_PATH = f"{FLOW_PATH}/callback"  # the redirect URI registered with Discord
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


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


def auth_routes(auth: Auth, authorize: Authorize, on_event: OnEvent | None) -> list[Route]:
    def session_id(request: Request) -> str | None:
        return session_id_from_cookie(request.headers.get("cookie"))

    def clear_session(response: Response) -> Response:
        response.delete_cookie(
            SESSION_COOKIE, path="/", secure=auth.secure_cookies, httponly=True, samesite="lax"
        )
        return response

    def failed(exc: KitError, title: str = "Sign-in failed") -> Response:
        return page(
            title,
            f"<p>{html.escape(exc.message)}</p><p><a href={BASE}/sign-in>Back to sign-in</a></p>",
            exc.status,
        )

    async def to_discord(claim_hash: str | None) -> Response:
        url, nonce = await auth.start(claim_hash)
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
        if auth.discord is None:
            body = (
                "<p>Discord sign-in is not configured: set CANCCU_DISCORD_CLIENT_ID,"
                " CANCCU_DISCORD_CLIENT_SECRET and CANCCU_PUBLIC_URL.</p>"
            )
        else:
            body = "<form method=post><button>Sign in with Discord</button></form>"
        if not await auth.store.has_owner():
            body += f"<p>First start? <a href={BASE}/first-run>Use the first-run code</a>.</p>"
        return page("Sign in", body)

    async def sign_in_start(request: Request) -> Response:
        try:
            return await to_discord(None)
        except KitError as exc:
            return failed(exc)

    def clear_flow(response: Response) -> Response:
        # The flow is used up whatever the outcome; its nonce has no further use.
        response.delete_cookie(
            FLOW_COOKIE, path=FLOW_PATH, secure=auth.secure_cookies, httponly=True, samesite="lax"
        )
        return response

    async def callback(request: Request) -> Response:
        query = request.query_params
        if "error" in query:
            cancelled = KitError("Sign-in was cancelled.", status=400, code="sign_in_cancelled")
            return clear_flow(failed(cancelled))
        try:
            token, _ = await auth.finish(
                query.get("state", ""),
                request.cookies.get(FLOW_COOKIE),
                query.get("code", ""),
                session_id(request),
            )
        except KitError as exc:
            return clear_flow(failed(exc))
        response = clear_flow(RedirectResponse(f"{BASE}/", status_code=303))
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
        if await auth.store.has_owner():
            return page(
                "First run",
                f"<p>This platform has an owner. <a href={BASE}/sign-in>Sign in</a>.</p>",
            )
        return page(
            "First run",
            "<p>Enter the first-run code from admin's log, then sign in with Discord:"
            " that Discord account becomes the owner.</p>"
            "<form method=post><input name=code autocomplete=off required>"
            " <button>Continue with Discord</button></form>",
        )

    async def first_run_start(request: Request) -> Response:
        form = await request.form()
        try:
            claim = await auth.check_first_run_code(str(form.get("code", "")))
            return await to_discord(claim)
        except KitError as exc:
            return failed(exc, "First run")

    async def sign_out_page(request: Request) -> Response:
        await auth.sign_out(session_id(request))
        return clear_session(RedirectResponse(f"{BASE}/sign-in", status_code=303))

    async def people_page(request: Request) -> Response:
        session = await authorize(request.headers.get("cookie"), "admin.rights.write")
        rows = []
        for user, role in await auth.users():
            if role == "owner":
                change = "owner"
            else:
                options = "".join(
                    f"<option value={v}{' selected' if (role or 'none') == v else ''}>{v}</option>"
                    for v in ("none", "admin")
                )
                change = (
                    f"<form method=post action={BASE}/people/{html.escape(user.id)}>"
                    f"<select name=role>{options}</select> <button>Save</button></form>"
                )
            rows.append(f"<tr><td>{html.escape(user.name)}</td><td>{change}</td></tr>")
        return page(
            "People",
            "<p>Everyone who has signed in. An admin may change settings and the profile;"
            " only the owner hands out roles.</p>"
            f"<table border=1 cellpadding=4><tr><th>Name<th>Role</tr>{''.join(rows)}</table>",
            session=session,
        )

    async def people_save(request: Request) -> Response:
        session = await authorize(request.headers.get("cookie"), "admin.rights.write")
        role = str((await request.form()).get("role", ""))
        event = await auth.set_role(
            str(request.path_params["user_id"]), None if role == "none" else role, session.user_id
        )
        if on_event is not None:
            # Drops this process's cached rights for that user at once (contracts/admin.md).
            await on_event(event)
        return RedirectResponse(f"{BASE}/people", status_code=303)

    return [
        Route("/api/admin/session", get_session, methods=["GET"]),
        Route("/api/admin/session/sign-out", sign_out_api, methods=["POST"]),
        Route("/sign-in", sign_in_page, methods=["GET"]),
        Route("/sign-in", sign_in_start, methods=["POST"]),
        Route("/sign-in/callback", callback, methods=["GET"]),
        Route("/first-run", first_run_page, methods=["GET"]),
        Route("/first-run", first_run_start, methods=["POST"]),
        Route("/sign-out", sign_out_page, methods=["POST"]),
        Route("/people", people_page, methods=["GET"]),
        Route("/people/{user_id}", people_save, methods=["POST"]),
    ]
