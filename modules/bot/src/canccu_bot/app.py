"""The ASGI app: the contract's `/api/bot/` paths behind tenant resolution (the hostname names the
event), the Discord page (pages.py; Caddy serves it under /bot/ and strips the prefix), and
`/health`. Platform hostnames are served too: the install callback answers on the
central sign-in host and the superadmin's unbind on the superadmin hostname; every event path
answers 404 there (access.tenant_of). `/internal/bot/` is for the other modules of the stack, behind
the kit's service identity and outside tenant resolution."""

from __future__ import annotations

from canccu_kit import Health, NotSignedIn, ServiceIdentity, TenantResolver
from canccu_kit.starlette import install, install_service_identity, install_tenancy
from starlette.applications import Starlette
from starlette.types import ASGIApp, Receive, Scope, Send

from . import (
    bind,
    clone,
    connection,
    credentials,
    guild,
    page_web,
    pages,
    presence_paths,
    providers,
    purposes,
    setup_check,
    stats,
    templates,
)
from .deps import Deps


def create_app(
    d: Deps, health: Health, resolver: TenantResolver, service: ServiceIdentity
) -> ASGIApp:
    private = Starlette(routes=presence_paths.ROUTES)
    private.state.deps = d
    private.state.tenants = resolver
    install(private)
    install_service_identity(private, service)
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

    async def dispatch(scope: Scope, receive: Receive, send: Send) -> None:
        # Tenancy would 404 the internal callers' host (`bot:8080`): they skip it.
        is_internal = scope["type"] == "http" and scope["path"].startswith("/internal/")
        await (private if is_internal else app)(scope, receive, send)

    return dispatch
