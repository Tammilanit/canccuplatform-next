"""Which requests run for a tenant, and how admin finds the tenant (0013 items 2 and 18).

Settings and the profile are per tenant, so their API and pages resolve the tenant from the
request's hostname through the kit. Everything else stays outside resolution: other modules ask
`/api/admin/session` on admin's internal host (`admin:8080`), which is no tenant's hostname, and
sign-in, people and the health view are not per tenant until the central sign-in (#52).
"""

from __future__ import annotations

import httpx
from canccu_kit import DEMO_TENANT, IpMode, TenantContext, TenantResolver, TenantsUnavailable
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


# Any IP literal will do: the tenants module serves the demo tenant on every one.
_IP_HOST = "127.0.0.1"


def ip_mode(version: str, tenants_url: str, http: httpx.AsyncClient) -> IpMode:
    """The IP-mode demo stack (CI): the demo tenant on an IP-literal host.

    Only the tenants module knows whether the demo tenant is the only tenant, the condition for IP
    mode (0013 item 2), and it applies it to its own IP-literal requests. So admin asks its public
    `GET /api/tenants/current` as a guest on an IP literal and serves the demo tenant only when
    that answers with it. Admin uses only the tenant id; the other fields are the most closed
    values, since a guest's answer does not carry them.
    """

    async def load() -> TenantContext | None:
        try:
            response = await http.get(
                f"{tenants_url.rstrip('/')}/api/tenants/current", headers={"host": _IP_HOST}
            )
        except httpx.HTTPError as exc:
            raise TenantsUnavailable(f"tenants module unreachable: {type(exc).__name__}") from exc
        if response.status_code == 404:
            return None
        if not response.is_success:
            raise TenantsUnavailable(f"tenants module answered {response.status_code}")
        body = response.json()
        if not isinstance(body, dict) or body.get("id") != DEMO_TENANT:
            return None
        return {
            "tenant_id": DEMO_TENANT,
            "status": body.get("status", "draft"),
            "primary_hostname": None,
            "time_zone": body.get("time_zone", "UTC"),
            "info_page_mode": "sign_in",
            "membership": "closed",
            "admin_access": "restricted",
            "venue": None,
            "venue_ip_check": {"enabled": True, "disabled_until": None, "reason": None},
            "flags_version": 0,
            "flags": {},
        }

    return IpMode(version, load)
