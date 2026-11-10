"""`PUT` and `DELETE /api/notify/topic-types/{custom_…}` (contracts/notify.md, Custom topics)."""

from __future__ import annotations

import json
from typing import Any

from canccu_kit import KitError, VersionConflict
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import custom, registry
from .access import tenant_ctx, topics_writer
from .config import configured, topics_with, write_settings
from .deps import Deps, deps
from .registry import bad, body_of, not_found


def _joined(d: Deps, key: str) -> dict[str, Any]:
    """`topics` with a new custom topic added, recomputed after a reload: a `topics` reset to
    unset meanwhile already means every topic, and a list of the new key alone would switch
    every other topic off."""
    if not isinstance(d.settings.get("topics"), list):
        return {}
    return topics_with(d.settings, [], key, True)


async def save(
    d: Deps, tenant_id: str, user_id: str, key: str, body: dict[str, Any]
) -> tuple[bool, dict[str, Any]]:
    """Adds (True) or replaces (False) a custom topic; the caller checked the right."""
    # A new topic may join admin's setting `topics`: no write while admin is unreachable.
    await d.settings.ensure()
    async with d.db.tenant() as conn:
        topic = custom.validate(key, body, await registry.load(conn))
        values = (
            key,
            topic["based_on"],
            topic["title"],
            topic["description"],
            json.dumps(topic["defaults"]),
            json.dumps(topic["conditions"]),
        )
        if topic["revision"] is None:
            saved = await conn.fetchval(
                "INSERT INTO notify_custom_topics (key, based_on, title, description, defaults,"
                " conditions) VALUES ($1, $2, $3, $4, $5, $6)"
                " ON CONFLICT (tenant_id, key) DO NOTHING RETURNING 1",
                *values,
            )
            if saved is None:
                raise KitError(f"{key} exists; send its revision", status=409, code="topic_exists")
            topics = d.settings.get("topics")
            # Offered from the start: an organiser who just made a topic means it to be offered.
            # An unset `topics` already means every topic.
            if isinstance(topics, list) and key not in topics:
                await write_settings(d, user_id, lambda: _joined(d, key))
        else:
            old_base = await conn.fetchval(
                "SELECT based_on FROM notify_custom_topics WHERE key = $1", key
            )
            saved = await conn.fetchval(
                "UPDATE notify_custom_topics SET based_on = $2, title = $3, description = $4,"
                " defaults = $5, conditions = $6, revision = revision + 1"
                " WHERE key = $1 AND revision = $7 RETURNING 1",
                *values,
                topic["revision"],
            )
            if saved is None:
                raise VersionConflict("changed or removed by someone else; reload")
            if old_base != topic["based_on"]:
                # Parameters set for the old base mean nothing to the new one.
                await conn.execute(
                    "UPDATE notify_topic_config SET params = '{}' WHERE key = $1", key
                )
        await d.audit.append(
            tenant_id, user_id, "notify.custom_topic.saved", {"type": "topic", "id": key}
        )
        result: dict[str, Any] = (await configured(conn, d.settings))[key]
    return topic["revision"] is None, result


async def remove(d: Deps, tenant_id: str, user_id: str, key: str, revision: int) -> None:
    await d.settings.ensure()
    async with d.db.tenant() as conn:
        gone = await conn.fetchval(
            "DELETE FROM notify_custom_topics WHERE key = $1 AND revision = $2 RETURNING 1",
            key,
            revision,
        )
        if gone is None:
            if await conn.fetchval("SELECT 1 FROM notify_custom_topics WHERE key = $1", key):
                raise VersionConflict("changed by someone else; reload")
            raise not_found()
        await conn.execute("DELETE FROM notify_topic_config WHERE key = $1", key)
        # A removed topic leaves admin's setting `topics` too, so a later one of the same key
        # does not inherit its switch.
        if isinstance(d.settings.get("topics"), list):
            await write_settings(d, user_id, lambda: topics_with(d.settings, [], key, False))
        await d.audit.append(
            tenant_id, user_id, "notify.custom_topic.removed", {"type": "topic", "id": key}
        )


def revision_of(raw: str | None) -> int:
    if raw is None or not raw.isdigit() or int(raw) < 1:
        raise bad("revision: a positive integer")
    return int(raw)


async def save_route(request: Request) -> Response:
    session = await topics_writer(request, write=True)
    body = await body_of(request)
    ctx = await tenant_ctx(request)
    key = request.path_params["topic"]
    created, result = await save(deps(request), ctx["tenant_id"], session.user_id, key, body)
    return JSONResponse(result, status_code=201 if created else 200)


async def remove_route(request: Request) -> Response:
    session = await topics_writer(request, write=True)
    ctx = await tenant_ctx(request)
    revision = revision_of(request.query_params.get("revision"))
    key = request.path_params["topic"]
    await remove(deps(request), ctx["tenant_id"], session.user_id, key, revision)
    return Response(status_code=204)


ROUTES = [
    Route("/api/notify/topic-types/{topic}", save_route, methods=["PUT"]),
    Route("/api/notify/topic-types/{topic}", remove_route, methods=["DELETE"]),
]
