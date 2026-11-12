"""The ASGI app: `/internal/agenda/` for modules, everything else behind tenant resolution; the
hostname names the event."""

from __future__ import annotations

from urllib.parse import urlencode

from canccu_kit import Health, IpMode, KitError, NotSignedIn, ServiceIdentity, TenantResolver
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
    announce,
    delay_pages,
    edit_pages,
    edits,
    internal,
    item_pages,
    items,
    kinds,
    pages,
    quickadd,
    template_pages,
    undo,
    web,
)
from .deps import Deps


def create_app(
    d: Deps,
    health: Health,
    resolver: TenantResolver,
    service: ServiceIdentity,
    ip_mode: IpMode | None = None,
) -> ASGIApp:
    del ip_mode  # the resolver carries it
    private = Starlette(routes=internal.ROUTES)
    private.state.deps = d
    private.state.tenants = resolver
    install(private)
    install_service_identity(private, service)
    # /items/new before /items/{item_id}: Starlette takes the first route that matches.
    routes = (
        items.ROUTES
        + edits.ROUTES
        + announce.ROUTES
        + kinds.ROUTES
        + item_pages.ROUTES
        + delay_pages.ROUTES
        + edit_pages.ROUTES
    )
    routes += pages.ROUTES + quickadd.ROUTES + template_pages.ROUTES + undo.ROUTES + web.ROUTES
    app = Starlette(routes=routes)
    # Starlette's slash redirects would drop the /agenda prefix Caddy strips.
    app.router.redirect_slashes = False
    app.state.deps = d
    app.state.tenants = resolver  # the event the shell's header names (web.event_of)
    install(app, health)
    install_tenancy(app, resolver)
    # After install(), so these replace the kit's JSON handler for the pages only.
    app.add_exception_handler(NotSignedIn, _not_signed_in)
    app.add_exception_handler(KitError, _kit_error)

    async def dispatch(scope: Scope, receive: Receive, send: Send) -> None:
        # Tenancy would 404 the internal callers' host (`agenda:8080`): they skip it.
        is_internal = scope["type"] == "http" and scope["path"].startswith("/internal/")
        await (private if is_internal else app)(scope, receive, send)

    return dispatch


async def _not_signed_in(request: Request, exc: Exception) -> Response:
    """The API answers 401 (contracts/agenda.md); a page sends the browser to sign in."""
    if request.url.path.startswith("/api/"):
        assert isinstance(exc, NotSignedIn)
        return JSONResponse(exc.to_body(), status_code=exc.status)
    back = sign_in_return(request, web.BASE, f"{web.BASE}/")
    return RedirectResponse(f"{web.SIGN_IN}?{urlencode({'next': back})}", status_code=303)


async def _kit_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, KitError)
    if request.url.path.startswith("/api/"):
        return JSONResponse(exc.to_body(), status_code=exc.status)
    return await web.error_page(request, exc)
