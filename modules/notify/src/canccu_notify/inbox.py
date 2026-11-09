"""Notification details and the inbox (contracts/notify.md, Notifications and the inbox)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from canccu_kit import KitError, NotSignedIn, check_info_access
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .access import client_ip, is_member, session_of, tenant_ctx
from .deps import deps
from .engine import parse_time
from .registry import bad

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
    member = session is not None and is_member(session)
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


async def inbox(request: Request) -> Response:
    """The caller's unexpired notifications, newest first. A session for now; the subscription
    token arrives with subscriptions (#225)."""
    await tenant_ctx(request)
    session = await session_of(request)
    if session is None:
        raise NotSignedIn("sign in, or use a subscription token")
    raw = request.query_params.get("since")
    since = parse_time(raw) if raw is not None else None
    if raw is not None and since is None:
        raise bad("since: an RFC 3339 time with an offset")
    audiences = ["public", "attendees"] if is_member(session) else ["public"]
    d = deps(request)
    async with d.db.tenant() as conn:
        rows = await conn.fetch(
            "SELECT * FROM notify_notifications WHERE expires_at > $1"
            " AND ($2::timestamptz IS NULL OR created_at > $2)"
            " AND (audience = ANY($3::text[]) OR user_id = $4)"
            " ORDER BY created_at DESC, id LIMIT $5",
            d.now(),
            since,
            audiences,
            session.user_id,
            INBOX_LIMIT,
        )
    return JSONResponse({"notifications": [view(r) for r in rows]})


ROUTES = [
    Route("/api/notify/notifications/{id}", notification, methods=["GET"]),
    Route("/api/notify/inbox", inbox, methods=["GET"]),
]
