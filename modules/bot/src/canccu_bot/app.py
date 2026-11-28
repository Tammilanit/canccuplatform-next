"""The ASGI app: the contract's `/api/bot/` paths behind tenant resolution (the hostname names the
event), the Discord page (pages.py; Caddy serves it under /bot/ and strips the prefix), and
`/health`. Platform hostnames are served too: the install callback answers on the
central sign-in host and the superadmin's unbind on the superadmin hostname; every event path
answers 404 there (access.tenant_of)."""

from __future__ import annotations

from canccu_kit import Health, NotSignedIn, TenantResolver
from canccu_kit.starlette import install, install_tenancy
from starlette.applications import Starlette

from . import (
    bind,
    clone,
    connection,
    credentials,
    guild,
    page_web,
    pages,
    providers,
    purposes,
    setup_check,
    stats,
    templates,
)
from .deps import Deps


def create_app(d: Deps, health: Health, resolver: TenantResolver) -> Starlette:
    routes = [
        *connection.ROUTES,
        *credentials.ROUTES,
        *bind.ROUTES,
        *guild.ROUTES,
        *clone.ROUTES,
        *providers.ROUTES,
        *templates.ROUTES,
        *purposes.ROUTES,
        *setup_check.ROUTES,
        *stats.ROUTES,
        *pages.ROUTES,
        *page_web.ROUTES,
    ]
    app = Starlette(routes=routes)
    # Starlette's slash redirects would drop the /bot prefix Caddy strips.
    app.router.redirect_slashes = False
    app.state.deps = d
    install(app, health, error_response=page_web.page_error)
    install_tenancy(app, resolver, platform_hosts="serve")
    # After install(), so it replaces the kit's handler for NotSignedIn on a page.
    app.add_exception_handler(NotSignedIn, page_web.not_signed_in)
    return app
