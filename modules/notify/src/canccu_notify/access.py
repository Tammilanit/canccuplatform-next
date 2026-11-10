"""Who is calling, and may they (contracts/notify.md, Who can do what; Rights)."""

from __future__ import annotations

from canccu_kit import KitError, MissingRight, NotSignedIn, check_admin_access, tailscale_cidrs
from canccu_kit.access import TenantContext
from canccu_kit.rights import Session
from starlette.requests import Request

from .deps import deps

TOPICS_WRITE = "notify.topics.write"
STATS_READ = "notify.stats.read"


def client_ip(request: Request) -> str | None:
    # uvicorn sets this from X-Forwarded-For only for the proxies it trusts (main.py).
    return request.client.host if request.client else None


def tenant_of(request: Request) -> TenantContext:
    ctx: TenantContext | None = request.state.tenant
    if ctx is None:  # a platform hostname: it has no notifications
        raise KitError("not found", status=404, code="not_found")
    return ctx


ZONES: dict[str, str] = {}
"""Time zones this container has stored, so a request writes only when the zone changed."""


async def tenant_ctx(request: Request) -> TenantContext:
    """The tenant of a request, and its time zone kept for the stream consumer."""
    ctx = tenant_of(request)
    tid, zone = ctx["tenant_id"], ctx["time_zone"]
    if ZONES.get(tid) != zone:
        async with deps(request).db.tenant(tid) as conn:
            await conn.execute(
                "INSERT INTO notify_event_state (time_zone) VALUES ($1)"
                " ON CONFLICT (tenant_id) DO UPDATE SET time_zone = $1",
                zone,
            )
        ZONES[tid] = zone
    return ctx


def is_member(session: Session) -> bool:
    """Whether the signed-in user belongs to the event.

    Until the tenants membership API lands (#150), every valid session on the event's hostname
    counts, as in the agenda: sessions are bound to one event, and today only organisers and crew
    have one. This is the one place to change when membership can be read.
    """
    return True


async def session_of(request: Request) -> Session | None:
    try:
        return await deps(request).rights.session(request.headers.get("cookie"))
    except NotSignedIn:
        return None


async def topics_writer(request: Request, *, write: bool = False) -> Session:
    """Right `notify.topics.write`, under the event's admin-access rule; a write also needs an
    event that is not archived (contracts/tenants.md, Lifecycle)."""
    ctx = tenant_of(request)
    session = await deps(request).rights.session(request.headers.get("cookie"))
    if not session.has(TOPICS_WRITE):
        raise MissingRight(f"needs right {TOPICS_WRITE}")
    check_admin_access(ctx, client_ip(request), tailscale_cidrs())  # 403 admin_access_restricted
    # The resolver's context is dropped on every tenants event, so its status is current.
    if write and ctx["status"] == "archived":
        raise KitError(
            "the event is archived and its notifications read-only",
            status=409,
            code="event_archived",
        )
    await tenant_ctx(request)
    return session
