"""Follows: a member follows entities of a topic with an entity-scoped personal part
(contracts/notify.md, Per-person channels and follows). Notify stores only the id; a follow of an
unknown id simply never matches."""

from __future__ import annotations

import re
from typing import Any

from canccu_kit import KitError
from canccu_kit.rights import Session
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .access import is_member, session_of, tenant_ctx, writable
from .config import configured, settings_ready
from .deps import deps
from .engine import MISSING, get, iso_time
from .registry import bad
from .subscriptions import sign_in_required

LIMIT = 200
ENTITY_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


def view(row: Any) -> dict[str, Any]:
    return {
        "topic": row["topic"],
        "entity_id": row["entity_id"],
        "created_at": iso_time(row["created_at"]),
    }


def entity_part(reg: dict[str, Any]) -> dict[str, Any] | None:
    part: dict[str, Any] | None = reg["parts"].get("personal")
    return part if part is not None and part["scope"] == "entity" else None


async def member(request: Request) -> Session:
    """Follows are a member's (401 `sign_in_required` for a guest, as the contract says)."""
    await tenant_ctx(request)
    session = await session_of(request)
    if session is None:
        raise sign_in_required()
    if not is_member(session.user_id):
        raise KitError("only members of the event follow", status=403, code="not_a_member")
    return session


async def followers(conn: Any, topic: str, entity_id: str) -> list[str]:
    rows = await conn.fetch(
        "SELECT user_id FROM notify_follows WHERE topic = $1 AND entity_id = $2 ORDER BY 1",
        topic,
        entity_id,
    )
    return [r["user_id"] for r in rows]


async def on_entity_event(conn: Any, found: dict[str, Any], envelope: dict[str, Any]) -> None:
    """A type's `merged` event moves its follows to the entity merged into (one follow for a
    person who followed both); its `removed` event deletes them."""
    for key, v in found.items():
        part = entity_part(v["topic_type"])
        entity = part["entity"] if part is not None else {}
        merged, removed = entity.get("merged"), entity.get("removed")
        if merged and merged["event"] == envelope["type"]:
            old, new = get(envelope, merged["from"]), get(envelope, merged["into"])
            if old is MISSING or new is MISSING or old == new:
                continue
            await conn.execute(
                "INSERT INTO notify_follows (user_id, topic, entity_id, created_at)"
                " SELECT user_id, topic, $3, created_at FROM notify_follows"
                " WHERE topic = $1 AND entity_id = $2 ON CONFLICT DO NOTHING",
                key,
                str(old),
                str(new),
            )
            await conn.execute(
                "DELETE FROM notify_follows WHERE topic = $1 AND entity_id = $2", key, str(old)
            )
        if removed and removed["event"] == envelope["type"]:
            gone = get(envelope, removed["id"])
            if gone is not MISSING:
                await conn.execute(
                    "DELETE FROM notify_follows WHERE topic = $1 AND entity_id = $2",
                    key,
                    str(gone),
                )


async def follow(request: Request) -> Response:
    session = await member(request)
    writable(await tenant_ctx(request))
    topic, entity_id = request.path_params["topic"], request.path_params["entity_id"]
    if not ENTITY_ID.fullmatch(entity_id):
        raise bad("entity_id: letters, digits, `_` or `-`, at most 64")
    d = deps(request)
    ready = await settings_ready(d.settings)
    async with d.db.tenant() as conn:
        found = (await configured(conn, d.settings if ready else None)).get(topic)
        if found is None or entity_part(found["topic_type"]) is None:
            raise KitError("this topic has nothing to follow", status=400, code="not_followable")
        # One person's follows are counted and added one at a time, so the limit holds.
        await conn.execute(
            "SELECT pg_advisory_xact_lock(hashtext("
            "'notify:follows:' || current_setting('canccu.tenant') || ':' || $1))",
            session.user_id,
        )
        row = await conn.fetchrow(
            "SELECT * FROM notify_follows WHERE user_id = $1 AND topic = $2 AND entity_id = $3",
            session.user_id,
            topic,
            entity_id,
        )
        if row is not None:
            return JSONResponse(view(row))
        count = await conn.fetchval(
            "SELECT count(*) FROM notify_follows WHERE user_id = $1", session.user_id
        )
        if count >= LIMIT:
            raise KitError(f"at most {LIMIT} follows", status=409, code="follow_limit")
        row = await conn.fetchrow(
            "INSERT INTO notify_follows (user_id, topic, entity_id, created_at)"
            " VALUES ($1, $2, $3, $4) RETURNING *",
            session.user_id,
            topic,
            entity_id,
            d.now(),
        )
    return JSONResponse(view(row), status_code=201)


async def unfollow(request: Request) -> Response:
    session = await member(request)
    async with deps(request).db.tenant() as conn:
        await conn.execute(
            "DELETE FROM notify_follows WHERE user_id = $1 AND topic = $2 AND entity_id = $3",
            session.user_id,
            request.path_params["topic"],
            request.path_params["entity_id"],
        )
    return Response(status_code=204)


async def listing(request: Request) -> Response:
    session = await member(request)
    async with deps(request).db.tenant() as conn:
        rows = await conn.fetch(
            "SELECT * FROM notify_follows WHERE user_id = $1 ORDER BY created_at, topic, entity_id",
            session.user_id,
        )
    return JSONResponse({"follows": [view(r) for r in rows]})


ROUTES = [
    Route("/api/notify/me/follows", listing, methods=["GET"]),
    Route("/api/notify/me/follows/{topic}/{entity_id}", follow, methods=["PUT"]),
    Route("/api/notify/me/follows/{topic}/{entity_id}", unfollow, methods=["DELETE"]),
]
