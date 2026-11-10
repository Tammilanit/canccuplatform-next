"""The caller's own settings and privacy: `GET`/`PATCH`/`DELETE /api/notify/me` and the export
(contracts/notify.md, The hub, Privacy; README.md#privacy-export-and-delete)."""

from __future__ import annotations

from typing import Any

from canccu_kit import NotSignedIn
from canccu_kit.rights import Session
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import checkin, inbox, people, subscriptions
from .access import session_of, tenant_ctx
from .deps import deps
from .follows import view as follow_view
from .registry import bad, body_of


async def signed_in(request: Request) -> Session:
    await tenant_ctx(request)
    session = await session_of(request)
    if session is None:
        raise NotSignedIn("sign in first")
    return session


def merged_channels(raw: Any, found: dict[str, Any], stored: dict[str, Any]) -> dict[str, Any]:
    """`stored` with the given choices laid over it, channel by channel. Only what the topic's
    part offers is accepted; a choice left out stays as it was (or the default)."""
    if not isinstance(raw, dict):
        raise bad("channels: an object")
    out = {topic: {part: dict(v) for part, v in parts.items()} for topic, parts in stored.items()}
    for topic, parts in raw.items():
        reg = found.get(topic, {}).get("topic_type")
        if reg is None or not isinstance(parts, dict):
            raise bad(f"channels.{topic}: not a topic")
        for part, switches in parts.items():
            offered = reg["parts"].get(part, {}).get("channels")
            if offered is None or not isinstance(switches, dict):
                raise bad(f"channels.{topic}.{part}: not a part of the topic")
            for channel, on in switches.items():
                if channel not in offered or not isinstance(on, bool):
                    raise bad(
                        f"channels.{topic}.{part}.{channel}: a channel of the part, true or false"
                    )
            out.setdefault(topic, {}).setdefault(part, {}).update(switches)
    return out


async def read(request: Request) -> Response:
    session = await signed_in(request)
    async with deps(request).db.tenant() as conn:
        return JSONResponse((await people.one(conn, session.user_id)).view())


async def update(request: Request) -> Response:
    session = await signed_in(request)
    body = await body_of(request)
    if "dm_fallback" in body and not isinstance(body["dm_fallback"], bool):
        raise bad("dm_fallback: true or false")
    d = deps(request)
    async with d.db.tenant() as conn:
        await conn.execute(
            "SELECT pg_advisory_xact_lock(hashtext("
            "'notify:people:' || current_setting('canccu.tenant') || ':' || $1))",
            session.user_id,
        )
        person = await people.one(conn, session.user_id)
        channels = person.channels
        if "channels" in body:
            found = await subscriptions.offered(d, conn)
            channels = merged_channels(body["channels"], found, channels)
        person = people.Person(body.get("dm_fallback", person.dm_fallback), channels)
        await people.save(conn, session.user_id, person)
    return JSONResponse(person.view())


async def export(request: Request) -> Response:
    """Everything Notify holds on the caller at this event; subscriptions without their keys."""
    session = await signed_in(request)
    d = deps(request)
    user = session.user_id
    async with d.db.tenant() as conn:
        found = await subscriptions.offered(d, conn)
        subs = await conn.fetch(
            "SELECT * FROM notify_subscriptions WHERE user_id = $1 ORDER BY created_at, id", user
        )
        follows = await conn.fetch(
            "SELECT * FROM notify_follows WHERE user_id = $1 ORDER BY created_at, topic, entity_id",
            user,
        )
        notes = await conn.fetch(
            "SELECT * FROM notify_notifications WHERE user_id = $1 ORDER BY created_at, id", user
        )
        check_ins = await conn.fetch(
            "SELECT id, purpose, checked_in_at FROM notify_check_ins WHERE user_id = $1"
            " ORDER BY checked_in_at, id",
            user,
        )
        person = await people.one(conn, user)
    return JSONResponse(
        {
            "subscriptions": [subscriptions.view(r, found) for r in subs],
            "me": person.view(),
            "follows": [follow_view(r) for r in follows],
            "notifications": [inbox.view(r) for r in notes],
            "check_ins": [checkin.view(r) for r in check_ins],
        }
    )


async def delete(request: Request) -> Response:
    """All of it at this event; with the subscriptions gone no push reaches the caller."""
    session = await signed_in(request)
    async with deps(request).db.tenant() as conn:
        user = session.user_id
        # The deliveries name the person too, also those of event-wide notifications.
        await conn.execute("DELETE FROM notify_deliveries WHERE recipient = $1", f"user:{user}")
        for table in (
            "notify_notifications", "notify_subscriptions", "notify_people", "notify_follows",
            "notify_check_ins",
        ):  # fmt: skip
            await conn.execute(f"DELETE FROM {table} WHERE user_id = $1", user)
    return Response(status_code=204)


ROUTES = [
    Route("/api/notify/me", read, methods=["GET"]),
    Route("/api/notify/me", update, methods=["PATCH"]),
    Route("/api/notify/me", delete, methods=["DELETE"]),
    Route("/api/notify/me/export", export, methods=["GET"]),
]
