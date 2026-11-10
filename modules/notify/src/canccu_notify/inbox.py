"""Notification details and the inbox (contracts/notify.md, Notifications and the inbox)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from canccu_kit import KitError, NotSignedIn, check_info_access
from canccu_kit.rights import Session
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .access import client_ip, is_member, session_of, tenant_ctx, tenant_of
from .deps import deps
from .engine import parse_time
from .registry import bad
from .subscriptions import by_token

INBOX_LIMIT = 200


def _time(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def view(row: Any) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": row["id"],
        "topic": row["topic"],
        "part": row["part"],
        "audience": row["audience"],
        "title": row["title"],
        "body": row["body"],
        "urgent": row["urgent"],
        "created_at": _time(row["created_at"]),
        "expires_at": _time(row["expires_at"]),
    }
    if row["url"] is not None:
        out["url"] = row["url"]
    if row["entity_id"] is not None:
        out["entity"] = {"type": row["entity_type"], "id": row["entity_id"]}
    return out


def collapse(rows: list[Any]) -> list[Any]:
    """A reader who gets both a custom topic's notification and its base's for one source event
    gets only the custom one (contracts/notify.md, Custom topics). `rows` are what this reader
    may see, so a base notification is dropped only for those who also see the custom one."""
    covered = {(r["source_event_id"], r["based_on"], r["user_id"]) for r in rows if r["based_on"]}
    return [r for r in rows if (r["source_event_id"], r["topic"], r["user_id"]) not in covered]


def _not_found() -> KitError:
    return KitError("no such notification", status=404, code="not_found")


async def notification(request: Request) -> Response:
    ctx = await tenant_ctx(request)
    session = await session_of(request)
    async with deps(request).db.tenant() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM notify_notifications WHERE id = $1", request.path_params["id"]
        )
    if row is None:
        raise _not_found()
    member = session is not None and is_member(session.user_id)
    if row["audience"] == "public" and not member:
        try:
            check_info_access(ctx, client_ip=client_ip(request), viewer="guest")
        except KitError as exc:
            # Whoever the info-page mode keeps out learns nothing, not even that it exists.
            raise _not_found() from exc
    elif row["audience"] == "attendees" and not member:
        raise _not_found()
    elif row["audience"] == "personal" and (session is None or session.user_id != row["user_id"]):
        raise _not_found()
    return JSONResponse(view(row))


async def _audiences(
    request: Request, conn: Any, session: Session | None
) -> tuple[list[str], str | None]:
    """The event-wide audiences the caller reads, and the user whose personal ones they read.

    A subscription token reads as its owner's audience (`attendees` only while that user is a
    member), never their personal notifications: those need the session."""
    if session is not None:
        member = is_member(session.user_id)
        return (["public", "attendees"] if member else ["public"]), session.user_id
    sub = await by_token(conn, request)
    if sub is None:
        raise NotSignedIn("sign in, or use a subscription token")
    if sub["user_id"] is not None and is_member(sub["user_id"]):
        return ["public", "attendees"], None
    try:
        check_info_access(tenant_of(request), client_ip=client_ip(request), viewer="guest")
    except KitError:
        return [], None  # the guest's subscription is kept, and reads nothing while closed
    return ["public"], None


async def inbox(request: Request) -> Response:
    """The caller's unexpired notifications, newest first."""
    await tenant_ctx(request)
    session = await session_of(request)
    d = deps(request)
    async with d.db.tenant() as conn:
        audiences, user_id = await _audiences(request, conn, session)
        raw = request.query_params.get("since")
        since = parse_time(raw) if raw is not None else None
        if raw is not None and since is None:
            raise bad("since: an RFC 3339 time with an offset")
        rows = await conn.fetch(
            "SELECT * FROM notify_notifications WHERE expires_at > $1"
            " AND ($2::timestamptz IS NULL OR created_at > $2)"
            " AND (audience = ANY($3::text[]) OR user_id = $4)"
            " ORDER BY created_at DESC, id LIMIT $5",
            d.now(),
            since,
            audiences,
            user_id,
            INBOX_LIMIT,
        )
    return JSONResponse({"notifications": [view(r) for r in collapse(rows)]})


ROUTES = [
    Route("/api/notify/notifications/{id}", notification, methods=["GET"]),
    Route("/api/notify/inbox", inbox, methods=["GET"]),
]
