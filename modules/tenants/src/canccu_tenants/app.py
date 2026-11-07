"""The ASGI app: public paths behind tenant resolution, internal paths without it."""

from __future__ import annotations

from canccu_kit import Health, IpMode, TenantContext, TenantResolver
from canccu_kit.starlette import install, install_tenancy
from starlette.applications import Starlette
from starlette.types import ASGIApp, Receive, Scope, Send

from . import current, hostnames, internal, registry, venue_info, venues
from .deps import Deps


class LocalResolver(TenantResolver):
    """The kit's resolver, answered from this module's own tables instead of over HTTP, and never
    cached: this module's own writes must show at once."""

    def __init__(self, d: Deps, platform_hosts: list[str], ip_mode: IpMode | None) -> None:
        super().__init__(
            "http://unused", platform_hosts=platform_hosts, ip_mode=ip_mode, cache_seconds=0
        )
        self._deps = d

    async def _lookup(self, host: str) -> TenantContext | None:
        return await internal.resolve_host(self._deps.db, host, self._deps.declared_flags)


def create_app(
    d: Deps, health: Health, platform_hosts: list[str], version: str = "", ip_mode: bool = False
) -> ASGIApp:
    async def load_demo() -> TenantContext | None:
        return await internal.demo_context(d.db, d.declared_flags)

    mode = IpMode(version, load_demo) if ip_mode else None
    public = Starlette(
        routes=current.ROUTES
        + venue_info.ROUTES
        + registry.ROUTES
        + hostnames.ROUTES
        + venues.ROUTES
    )
    public.state.deps = d
    install(public, health)
    # `serve`: the superadmin hostname is a platform host, and its paths live here.
    install_tenancy(public, LocalResolver(d, platform_hosts, mode), platform_hosts="serve")

    private = Starlette(routes=internal.ROUTES)
    private.state.deps = d
    install(private)

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        # Tenancy would 404 the internal callers' host (`tenants:8080`): they skip it.
        is_internal = scope["type"] == "http" and scope["path"].startswith("/internal/")
        await (private if is_internal else public)(scope, receive, send)

    return app
