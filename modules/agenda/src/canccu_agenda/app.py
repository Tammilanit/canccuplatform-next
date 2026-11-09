"""The ASGI app: every path behind tenant resolution; the hostname names the event."""

from __future__ import annotations

from canccu_kit import Health, IpMode, KitError, NotSignedIn, TenantResolver
from canccu_kit.starlette import install, install_tenancy
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response

from . import edit_pages, edits, item_pages, items, kinds, pages, quickadd, template_pages, web
from .deps import Deps


def create_app(
    d: Deps, health: Health, resolver: TenantResolver, ip_mode: IpMode | None = None
) -> Starlette:
    del ip_mode  # the resolver carries it
    # /items/new before /items/{item_id}: Starlette takes the first route that matches.
    routes = items.ROUTES + edits.ROUTES + kinds.ROUTES + item_pages.ROUTES + edit_pages.ROUTES
    routes += pages.ROUTES + quickadd.ROUTES + template_pages.ROUTES + web.ROUTES
    app = Starlette(routes=routes)
    app.state.deps = d
    install(app, health)
    install_tenancy(app, resolver)
    # After install(), so these replace the kit's JSON handler for the pages only.
    app.add_exception_handler(NotSignedIn, _not_signed_in)
    app.add_exception_handler(KitError, _kit_error)
    return app


async def _not_signed_in(request: Request, exc: Exception) -> Response:
    """The API answers 401 (contracts/agenda.md); a page sends the browser to sign in."""
    if request.url.path.startswith("/api/"):
        assert isinstance(exc, NotSignedIn)
        return JSONResponse(exc.to_body(), status_code=exc.status)
    return RedirectResponse(web.SIGN_IN, status_code=303)


async def _kit_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, KitError)
    if request.url.path.startswith("/api/"):
        return JSONResponse(exc.to_body(), status_code=exc.status)
    return web.error_page(request, exc)
