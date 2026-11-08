"""Which requests run for a tenant, and how admin finds the tenant (0013 items 2 and 18).

Settings and the profile are per tenant, so their API and pages resolve the tenant from the
request's hostname through the kit. Everything else stays outside resolution: other modules ask
`/api/admin/session` on admin's internal host (`admin:8080`), which is no tenant's hostname, and
sign-in, people and the health view are not per tenant until the central sign-in (#52).
"""

from __future__ import annotations

from canccu_kit import TenantResolver
from canccu_kit.starlette import TenancyMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

# Page paths as admin sees them, after Caddy strips `/admin`.
TENANT_PATHS = ("/api/admin/settings", "/api/admin/profile", "/settings", "/profile")


def is_tenant_path(path: str) -> bool:
    return any(path == p or path.startswith(f"{p}/") for p in TENANT_PATHS)


class TenantPaths:
    """The kit's tenancy middleware, for the tenant paths only."""

    def __init__(self, app: ASGIApp, resolver: TenantResolver) -> None:
        self.app = app
        self.tenancy = TenancyMiddleware(app, resolver)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and is_tenant_path(scope["path"]):
            await self.tenancy(scope, receive, send)
        else:
            await self.app(scope, receive, send)
