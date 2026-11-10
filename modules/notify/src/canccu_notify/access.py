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


async def tenant_ctx(request: Request) -> TenantContext:
    """The tenant of a request, and its time zone, info-page mode and status kept for the stream
    consumer and the sender, which have no request. Compared with the stored row, not with what
    this process wrote last: another container may have written since."""
    ctx = tenant_of(request)
    async with deps(request).db.tenant(ctx["tenant_id"]) as conn:
        await conn.execute(
            "INSERT INTO notify_event_state (time_zone, info_page_mode, status)"
            " VALUES ($1, $2, $3) ON CONFLICT (tenant_id) DO UPDATE"
            " SET time_zone = $1, info_page_mode = $2, status = $3"
            " WHERE (notify_event_state.time_zone, notify_event_state.info_page_mode,"
            " notify_event_state.status) IS DISTINCT FROM ($1, $2, $3)",
            ctx["time_zone"],
            ctx["info_page_mode"],
            ctx["status"],
        )
    return ctx


def writable(ctx: TenantContext) -> None:
    """An archived event is read-only (contracts/tenants.md, Lifecycle)."""
    if ctx["status"] == "archived":
        raise KitError(
            "the event is archived and its notifications read-only",
            status=409,
            code="event_archived",
        )


def is_member(user_id: str) -> bool:
    """Whether the user belongs to the event, asked for a session, a user's subscription token and
    each push to a user's phone.

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
    if write:
        writable(ctx)
    await tenant_ctx(request)
    return session
