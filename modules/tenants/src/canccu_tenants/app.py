"""The ASGI app: public paths behind tenant resolution, internal paths without it."""

from __future__ import annotations

import httpx
from canccu_kit import Health, IpMode, ServiceIdentity, TenantResolver
from canccu_kit.starlette import install, install_service_identity, install_tenancy
from starlette.applications import Starlette
from starlette.types import ASGIApp, Receive, Scope, Send

from . import current, hostnames, internal, registry, storage, venue_info, venues
from .deps import Deps


def create_app(
    d: Deps,
    health: Health,
    platform_hosts: list[str],
    version: str = "",
    ip_mode: bool = False,
    *,
    service: ServiceIdentity,
) -> ASGIApp:
    mode = IpMode(version) if ip_mode else None
    private = Starlette(
        routes=internal.ROUTES + storage.INTERNAL_ROUTES + venue_info.INTERNAL_ROUTES
    )
    private.state.deps = d
    private.state.ip_mode = mode is not None
    install(private)
    # Caddy's on-demand TLS cannot sign, and `ask` only says whether a hostname is active.
    install_service_identity(private, service, exempt=("/internal/tenants/ask",))
    # The kit's own resolver, asking this module's internal endpoint in-process: one code path
    # for every module. No cache, so this module's own writes show at once.
    resolver = TenantResolver(
        "http://tenants",
        platform_hosts=platform_hosts,
        ip_mode=mode,
        http=httpx.AsyncClient(transport=httpx.ASGITransport(app=private)),
        service=service,
        cache_seconds=0,
    )
    public = Starlette(
        routes=current.ROUTES
        + storage.ROUTES
        + venue_info.ROUTES
        + registry.ROUTES
        + hostnames.ROUTES
        + venues.ROUTES
    )
    public.state.deps = d
    install(public, health)
    # `serve`: the superadmin hostname is a platform host, and its paths live here.
    install_tenancy(public, resolver, platform_hosts="serve")

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        # Tenancy would 404 the internal callers' host (`tenants:8080`): they skip it.
        is_internal = scope["type"] == "http" and scope["path"].startswith("/internal/")
        await (private if is_internal else public)(scope, receive, send)

    return app
