"""Who is calling, and may they (contracts/tenants.md, Users, roles and membership; Access).

Until the central sign-in (#52), the caller comes only from admin's session through the kit's
RightsChecker, and its user id is taken as the tenants user id (plan, Q2). The event-admin role and
the superadmin flag are this module's own rows, read by that id.
"""

from __future__ import annotations

from typing import Any

from canccu_kit import (
    KitError,
    MissingRight,
    NotSignedIn,
    RightsChecker,
    TenantContext,
    check_admin_access,
    tailscale_cidrs,
)
from canccu_kit.resolve import normalize_host
from canccu_kit.rights import Session
from starlette.requests import Request

from .db import Db
from .model import not_found

ROLE_ONLY = frozenset({"tenants.admins.write", "tenants.lifecycle.write", "tenants.access.write"})
"""Only the event-admin role holds these, never a granted right: no right can make an admin."""


def client_ip(request: Request) -> str | None:
    # uvicorn sets this from X-Forwarded-For only for the proxies it trusts (main.py).
    return request.client.host if request.client else None


def tenant_of(request: Request) -> TenantContext:
    ctx: TenantContext | None = request.state.tenant
    if ctx is None:  # a platform hostname: there is no "current" event there
        raise not_found()
    return ctx


class Caller:
    def __init__(self, db: Db, rights: RightsChecker, superadmin_host: str | None) -> None:
        self.db = db
        self.rights = rights
        self.superadmin_host = normalize_host(superadmin_host)
        self.tailscale = tailscale_cidrs()

    async def session(self, request: Request) -> Session | None:
        try:
            return await self.rights.session(request.headers.get("cookie"))
        except NotSignedIn:
            return None

    async def is_event_admin(self, tenant_id: str, user_id: str) -> bool:
        async with self.db.tenant(tenant_id) as conn:
            found = await conn.fetchval("SELECT 1 FROM event_admins WHERE user_id = $1", user_id)
        return found is not None

    async def can(self, ctx: TenantContext, session: Session | None, right: str) -> bool:
        if session is None:
            return False
        if await self.is_event_admin(ctx["tenant_id"], session.user_id):
            return True
        return right not in ROLE_ONLY and session.has(right)

    async def require(self, request: Request, right: str) -> Session:
        """A right in the request's tenant: signed in, from an allowed address, role or right."""
        ctx = tenant_of(request)
        session = await self.rights.session(request.headers.get("cookie"))
        check_admin_access(ctx, client_ip(request), self.tailscale)
        if not await self.can(ctx, session, right):
            raise MissingRight(f"needs right {right}")
        return session

    async def require_all(self, request: Request, rights: set[str]) -> Session | None:
        session = None
        for right in sorted(rights):
            session = await self.require(request, right)
        return session

    async def superadmin(self, request: Request) -> Session:
        """Superadmin paths exist only on the superadmin hostname; elsewhere they are 404 before
        any auth check, so a tenant's hostname learns nothing about them."""
        if self.superadmin_host is None or normalize_host(request.url.hostname) != (
            self.superadmin_host
        ):
            raise not_found()
        session = await self.rights.session(request.headers.get("cookie"))
        async with self.db.platform() as conn:
            user: Any = await conn.fetchrow(
                "SELECT superadmin, mfa_enabled FROM users WHERE id = $1", session.user_id
            )
        if user is None or not user["superadmin"]:
            raise KitError("superadmins only", status=403, code="superadmin_required")
        if not user["mfa_enabled"]:
            raise KitError("turn on Discord two-factor first", status=403, code="mfa_required")
        return session
