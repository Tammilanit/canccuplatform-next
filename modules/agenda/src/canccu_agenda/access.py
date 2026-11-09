"""Who may read which items, and who may write (contracts/agenda.md, Reading and Rights)."""

from __future__ import annotations

from dataclasses import dataclass

from canccu_kit import KitError, MissingRight, NotSignedIn, check_info_access
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
    if session is not None and session.has(CREW_READ):
        seen.add("crew")
    if "attendees" not in seen:
        # A guest sees public items only when the event's info-page mode lets it in.
        client = request.client.host if request.client else None
        check_info_access(ctx, client_ip=client, viewer="guest")
    return Viewer(session, frozenset(seen))


async def writer(request: Request) -> Session:
    """The session of a write: right `agenda.items.write`, on an event that is not archived."""
    ctx = tenant_of(request)
    session = await deps(request).rights.session(request.headers.get("cookie"))
    if not session.has(WRITE):
        raise MissingRight(f"needs right {WRITE}")
    # The resolver's context is dropped on every tenants event, tenants.status.changed included,
    # so its status is the event's current one.
    if ctx["status"] == "archived":
        raise KitError(
            "the event is archived and its agenda read-only", status=409, code="event_archived"
        )
    return session
