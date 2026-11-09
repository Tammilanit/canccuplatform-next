"""Who may read which items, and who may write (contracts/agenda.md, Reading and Rights)."""

from __future__ import annotations

from dataclasses import dataclass

from canccu_kit import (
    AdminAccessRestricted,
    KitError,
    MissingRight,
    NotSignedIn,
    check_admin_access,
    check_info_access,
    tailscale_cidrs,
)
from canccu_kit.access import TenantContext
from canccu_kit.rights import Session
from starlette.requests import Request

from .deps import deps

WRITE = "agenda.items.write"
CREW_READ = "agenda.crew.read"


@dataclass(frozen=True)
class Viewer:
    session: Session | None
    visibilities: frozenset[str]


def client_ip(request: Request) -> str | None:
    # uvicorn sets this from X-Forwarded-For only for the proxies it trusts (main.py).
    return request.client.host if request.client else None


def from_admin_network(request: Request, ctx: TenantContext) -> bool:
    """The tenants contract's `admin_access`: with `restricted`, every request that needs a right
    comes from the venue's addresses or Tailscale."""
    try:
        check_admin_access(ctx, client_ip(request), tailscale_cidrs())
    except AdminAccessRestricted:
        return False
    return True


def tenant_of(request: Request) -> TenantContext:
    ctx: TenantContext | None = request.state.tenant
    if ctx is None:  # a platform hostname: it has no agenda
        raise KitError("not found", status=404, code="not_found")
    return ctx


def is_member(session: Session) -> bool:
    """Whether the signed-in user belongs to the event.

    Until the tenants membership API lands (#150), every valid session on the event's hostname
    counts: sessions are bound to one event, and today only organisers and crew have one. This is
    the one place to change when membership can be read.
    """
    return True


async def viewer(request: Request) -> Viewer:
    ctx = tenant_of(request)
    try:
        session: Session | None = await deps(request).rights.session(request.headers.get("cookie"))
    except NotSignedIn:
        session = None
    seen = {"public"}
    if session is not None and is_member(session):
        seen.add("attendees")
    # Crew items need a right, so they follow the admin-access rule; outside it the caller still
    # reads what it could read without the right.
    if session is not None and session.has(CREW_READ) and from_admin_network(request, ctx):
        seen.add("crew")
    if "attendees" not in seen:
        # A guest sees public items only when the event's info-page mode lets it in.
        check_info_access(ctx, client_ip=client_ip(request), viewer="guest")
    return Viewer(session, frozenset(seen))


async def writer(request: Request) -> Session:
    """The session of a write: right `agenda.items.write`, on an event that is not archived."""
    ctx = tenant_of(request)
    session = await deps(request).rights.session(request.headers.get("cookie"))
    if not session.has(WRITE):
        raise MissingRight(f"needs right {WRITE}")
    check_admin_access(ctx, client_ip(request), tailscale_cidrs())  # 403 admin_access_restricted
    # The resolver's context is dropped on every tenants event, tenants.status.changed included,
    # so its status is the event's current one.
    if ctx["status"] == "archived":
        raise KitError(
            "the event is archived and its agenda read-only", status=409, code="event_archived"
        )
    return session
