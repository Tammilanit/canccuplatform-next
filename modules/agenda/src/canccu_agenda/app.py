"""The ASGI app: every path behind tenant resolution; the hostname names the event."""

from __future__ import annotations

from canccu_kit import Health, IpMode, TenantResolver
from canccu_kit.starlette import install, install_tenancy
from starlette.applications import Starlette

from . import items, kinds
from .deps import Deps


def create_app(
    d: Deps, health: Health, resolver: TenantResolver, ip_mode: IpMode | None = None
) -> Starlette:
    del ip_mode  # the resolver carries it
    app = Starlette(routes=items.ROUTES + kinds.ROUTES)
    app.state.deps = d
    install(app, health)
    install_tenancy(app, resolver)
    return app
