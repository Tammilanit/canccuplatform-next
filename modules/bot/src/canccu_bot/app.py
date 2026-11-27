"""The ASGI app: the contract's `/api/bot/` paths behind tenant resolution (the hostname names the
event), and `/health`. Platform hostnames are served too: the install callback answers on the
central sign-in host and the superadmin's unbind on the superadmin hostname; every event path
answers 404 there (access.tenant_of)."""

from __future__ import annotations

from canccu_kit import Health, TenantResolver
from canccu_kit.starlette import install, install_tenancy
from starlette.applications import Starlette

from . import bind, connection, credentials, guild
from .deps import Deps


def create_app(d: Deps, health: Health, resolver: TenantResolver) -> Starlette:
    app = Starlette(routes=[*connection.ROUTES, *credentials.ROUTES, *bind.ROUTES, *guild.ROUTES])
    app.state.deps = d
    install(app, health)
    install_tenancy(app, resolver, platform_hosts="serve")
    return app
