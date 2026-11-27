"""The ASGI app: the contract's `/api/bot/` paths behind tenant resolution (the hostname names the
event), and `/health`."""

from __future__ import annotations

from canccu_kit import Health, TenantResolver
from canccu_kit.starlette import install, install_tenancy
from starlette.applications import Starlette

from . import connection
from .deps import Deps


def create_app(d: Deps, health: Health, resolver: TenantResolver) -> Starlette:
    app = Starlette(routes=list(connection.ROUTES))
    app.state.deps = d
    install(app, health)
    install_tenancy(app, resolver)
    return app
