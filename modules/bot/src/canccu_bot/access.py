"""Who may do what, and the seams the bot stands on until the tenants module serves membership,
the event-admin role and the central sign-in (docs/plans/issue-121.md, B11). Each seam is one
function here, named in the README, so its replacement changes one place."""

from __future__ import annotations

import httpx
from canccu_kit import KitError, MissingRight, ServiceIdentity
from canccu_kit.access import TenantContext, check_admin_access, tailscale_cidrs
from canccu_kit.rights import Session
from starlette.requests import Request

from .deps import Deps

EVENT_ADMIN_SEAM = "admin.rights.write"


def deps(request: Request) -> Deps:
    found: Deps = request.app.state.deps
    return found


def tenant_of(request: Request) -> TenantContext:
    ctx: TenantContext | None = request.state.tenant
    if ctx is None:  # a platform hostname names no event
        raise KitError("not found", status=404, code="not_found")
    return ctx


def client_ip(request: Request) -> str | None:
    # uvicorn sets the client from X-Forwarded-For only for the proxies it trusts (main.py).
    return request.client.host if request.client else None


def archived() -> KitError:
    return KitError("the event is archived and read-only", status=409, code="event_archived")


def is_event_admin(session: Session) -> bool:
    """Seam: the event-admin role is "holds `admin.rights.write`" until #150 serves the role
    itself. Today only the owner holds it, so it fails closed: no granted right reaches a bot
    write (contracts/bot.md, Who)."""
    return session.has(EVENT_ADMIN_SEAM)


async def event_admin(request: Request, *, writable: bool = True) -> tuple[TenantContext, Session]:
    """A bot write: the event-admin role itself, under the event's admin-access rule; on an
    archived event only what deletes data (`writable=False`)."""
    ctx = tenant_of(request)
    session = await deps(request).rights.session(request.headers.get("cookie"))
    if not is_event_admin(session):
        raise MissingRight("needs the event-admin role")
    check_admin_access(ctx, client_ip(request), tailscale_cidrs())  # 403 admin_access_restricted
    if writable and ctx["status"] == "archived":
        raise archived()
    return ctx, session


class UsersReader:
    """Seam: a user's Discord id from `GET /internal/tenants/users/{user_id}`. Until #150 serves
    it the answer is 404, read as no Discord id, so a bind fails closed with
    `discord_user_mismatch` rather than trust an id the platform cannot confirm."""

    def __init__(self, base_url: str, identity: ServiceIdentity) -> None:
        self._base = base_url.rstrip("/") + "/internal/tenants/users/"
        self._identity = identity
        self._http = httpx.AsyncClient(timeout=5.0)

    async def discord_id(self, user_id: str) -> str | None:
        response = await self._http.get(
            self._base + user_id, headers=self._identity.headers("tenants")
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        value = response.json().get("discord_user_id")
        return value if isinstance(value, str) and value else None


class TenantsAudit:
    """`POST /internal/tenants/audit` (contracts/tenants.md, Audit log): which credential changed
    and who, never a value."""

    def __init__(self, base_url: str, identity: ServiceIdentity) -> None:
        self._url = base_url.rstrip("/") + "/internal/tenants/audit"
        self._identity = identity
        self._http = httpx.AsyncClient(timeout=5.0)

    async def append(
        self,
        tenant_id: str,
        actor_user_id: str | None,
        action: str,
        target: dict[str, str],
        changes: dict[str, object] | None = None,
        reason: str | None = None,
    ) -> None:
        body = {
            "tenant_id": tenant_id,
            "module": "bot",
            "actor_user_id": actor_user_id,
            "action": action,
            "target": target,
            "changes": changes or {},
            "reason": reason,
        }
        response = await self._http.post(
            self._url, json=body, headers=self._identity.headers("tenants")
        )
        response.raise_for_status()


class SeriesReader:
    """Seam: whether the caller is an event admin of both events of one series, from
    `GET /api/tenants/current/series` on the request's hostname with the caller's cookie, the read
    the tenants contract names for a module's clone. Until #150 serves it the answer is 404, read
    as no, so a clone fails closed with 403 `missing_right`."""

    def __init__(self, base_url: str) -> None:
        self._url = base_url.rstrip("/") + "/api/tenants/current/series"
        self._http = httpx.AsyncClient(timeout=5.0)

    async def admin_of_both(self, host: str, cookie: str | None, source: str, target: str) -> bool:
        headers = {"host": host} if cookie is None else {"host": host, "cookie": cookie}
        response = await self._http.get(self._url, headers=headers)
        if response.status_code != 200:
            return False
        events = response.json().get("events")
        if not isinstance(events, list):
            return False
        admin_of = {e.get("id") for e in events if isinstance(e, dict) and e.get("caller_is_admin")}
        return source in admin_of and target in admin_of
