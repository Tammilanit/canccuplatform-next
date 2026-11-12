"""The ASGI app: `/internal/notify/` for modules, everything else behind tenant resolution."""

from __future__ import annotations

from urllib.parse import urlencode

from canccu_kit import Health, KitError, NotSignedIn, ServiceIdentity, TenantResolver
from canccu_kit.starlette import (
    install,
    install_service_identity,
    install_tenancy,
    sign_in_return,
)
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from . import (
    checkin,
    checkin_page,
    config,
    custom_api,
    custom_pages,
    follows,
    inbox,
    me,
    push,
    registry,
    subscriptions,
    topic_pages,
    web,
)
from .deps import Deps


def create_app(
    d: Deps, health: Health, resolver: TenantResolver, service: ServiceIdentity
) -> ASGIApp:
    private = Starlette(routes=registry.ROUTES + checkin.INTERNAL_ROUTES)
    private.state.deps = d
    install(private)
    install_service_identity(private, service)
    # /admin/topics/new before /admin/topics/{topic}: Starlette takes the first route that matches.
    pages = custom_pages.ROUTES + topic_pages.ROUTES + web.ROUTES + checkin_page.ROUTES
    api = (
        config.ROUTES
        + custom_api.ROUTES
        + inbox.ROUTES
        + checkin.ROUTES
        + push.ROUTES
        + subscriptions.ROUTES
        + me.ROUTES
        + follows.ROUTES
    )
    public = Starlette(routes=api + pages)
    # Starlette's slash redirects would drop the /notify prefix Caddy strips.
    public.router.redirect_slashes = False
    public.state.deps = d
    public.state.tenants = resolver  # the event the shell's header names (web.event_of)
    install(public, health, error_response=_page_error)
    install_tenancy(public, resolver, error_response=_page_error)
    # After install(), so it replaces the kit's handler for NotSignedIn.
    public.add_exception_handler(NotSignedIn, _not_signed_in)

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        # Tenancy would 404 the internal callers' host (`notify:8080`): they skip it.
        is_internal = scope["type"] == "http" and scope["path"].startswith("/internal/")
        await (private if is_internal else public)(scope, receive, send)

    return app


def _is_page(request: Request) -> bool:
    return request.url.path.startswith("/admin/")


async def _not_signed_in(request: Request, exc: Exception) -> Response:
    """The API answers 401 (contracts/notify.md); a page sends the browser to sign in."""
    assert isinstance(exc, NotSignedIn)
    if not _is_page(request):
        return JSONResponse(exc.to_body(), status_code=exc.status)
    back = sign_in_return(request, web.BASE, f"{web.BASE}/admin/topics")
    return RedirectResponse(f"{web.SIGN_IN}?{urlencode({'next': back})}", status_code=303)


async def _page_error(request: Request, exc: KitError) -> Response | None:
    """A page gets its errors as a page, the API as the kit's JSON body (None)."""
    if request.url.path == checkin_page.PATH.removeprefix("/notify"):
        return await checkin_page.error_page(request, exc)
    return await web.error_page(request, exc) if _is_page(request) else None
