"""The ASGI app: `/internal/notify/` for modules, everything else behind tenant resolution."""

from __future__ import annotations

from canccu_kit import Health, ServiceIdentity, TenantResolver
from canccu_kit.starlette import install, install_service_identity, install_tenancy
from starlette.applications import Starlette
from starlette.types import ASGIApp, Receive, Scope, Send

from . import config, inbox, push, registry, subscriptions
from .deps import Deps


def create_app(
    d: Deps, health: Health, resolver: TenantResolver, service: ServiceIdentity
) -> ASGIApp:
    private = Starlette(routes=registry.ROUTES)
    private.state.deps = d
    install(private)
    install_service_identity(private, service)
    public = Starlette(routes=config.ROUTES + inbox.ROUTES + push.ROUTES + subscriptions.ROUTES)
    public.state.deps = d
    install(public, health)
    install_tenancy(public, resolver)

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        # Tenancy would 404 the internal callers' host (`notify:8080`): they skip it.
        is_internal = scope["type"] == "http" and scope["path"].startswith("/internal/")
        await (private if is_internal else public)(scope, receive, send)

    return app
