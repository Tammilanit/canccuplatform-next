"""Each event's configuration of the topic types (contracts/notify.md, Per-event configuration)."""

from __future__ import annotations

import json
import logging
from typing import Any

from canccu_kit import AdminUnavailable, VersionConflict, check_info_access
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import registry
from .access import client_ip, session_of, tenant_ctx, topics_writer
from .deps import Settings, deps
from .registry import bad, body_of, not_found

log = logging.getLogger("canccu_notify.config")


async def settings_ready(settings: Settings) -> bool:
    """Reads go on with the declared defaults while admin is down; nothing is held up by it."""
    try:
        await settings.ensure()
    except AdminUnavailable:
        log.warning("admin unreachable: topic configuration uses the defaults")
        return False
    return True


def type_channels(reg: dict[str, Any]) -> list[str]:
    seen: dict[str, None] = {}
    for part in reg["parts"].values():
        seen.update(dict.fromkeys(part["channels"]))
    return list(seen)


def effective(reg: dict[str, Any], row: Any, settings: Settings | None) -> dict[str, Any]:
    """The configuration in effect. An explicit value of the event wins; otherwise the admin
    settings `topics` and `schedule_lead_minutes`, which the contract keeps equal to `enabled`
    and the `schedule` topic's `lead_minutes`; otherwise the type's defaults."""
    key = reg["key"]
    topics = settings.get("topics") if settings is not None else None
    enabled = row["enabled"] if row is not None and row["enabled"] is not None else None
    if enabled is None:
        enabled = key in topics if isinstance(topics, list) else True
    params = {p["key"]: p["default"] for p in reg.get("params") or []}
    lead = settings.get("schedule_lead_minutes") if settings is not None else None
    if key == "schedule" and "lead_minutes" in params and isinstance(lead, int):
        params["lead_minutes"] = lead
    if row is not None:
        params.update(json.loads(row["params"]))
    channels = type_channels(reg)
    if row is not None and row["channels"] is not None:
        channels = [c for c in channels if c in row["channels"]]
    return {
        "config_version": row["config_version"] if row is not None else 0,
        "enabled": enabled,
        "params": params,
        "channels": channels,
    }


async def configured(conn: Any, settings: Settings | None) -> dict[str, dict[str, Any]]:
    """Every registered type with this event's configuration, by key."""
    regs = await registry.load(conn)
    rows = {r["key"]: r for r in await conn.fetch("SELECT * FROM notify_topic_config")}
    return {
        k: {"topic_type": reg, "config": effective(reg, rows.get(k), settings)}
        for k, reg in regs.items()
    }


async def list_types(request: Request) -> Response:
    await topics_writer(request)
    d = deps(request)
    ready = await settings_ready(d.settings)
    async with d.db.tenant() as conn:
        found = await configured(conn, d.settings if ready else None)
    return JSONResponse({"topic_types": list(found.values())})


def _check_params(reg: dict[str, Any], params: Any) -> dict[str, Any]:
    if not isinstance(params, dict):
        raise bad("params: an object")
    declared = {p["key"]: p for p in reg.get("params") or []}
    for k, v in params.items():
        p = declared.get(k)
        if p is None:
            raise bad(f"params.{k}: the topic type has no such parameter")
        kind = {"integer": int, "boolean": bool, "string": str}[p["type"]]
        if not isinstance(v, kind) or (kind is int and isinstance(v, bool)):
            raise bad(f"params.{k}: must be {p['type']}")
        if kind is int and not p.get("min", v) <= v <= p.get("max", v):
            raise bad(f"params.{k}: outside {p.get('min')}..{p.get('max')}")
    return params


async def configure(request: Request) -> Response:
    session = await topics_writer(request)
    key = request.path_params["topic"]
    body = await body_of(request)
    version = body.get("config_version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 0:
        raise bad("config_version: required")
    d = deps(request)
    ctx = await tenant_ctx(request)
    ready = await settings_ready(d.settings)
    async with d.db.tenant() as conn:
        regs = await registry.load(conn)
        reg = regs.get(key)
        if reg is None:
            raise not_found()
        row = await conn.fetchrow(
            "SELECT * FROM notify_topic_config WHERE key = $1 FOR UPDATE", key
        )
        current = row["config_version"] if row is not None else 0
        if version != current:
            raise VersionConflict(f"config_version is {current}")
        enabled = row["enabled"] if row is not None else None
        params = json.loads(row["params"]) if row is not None else {}
        channels = row["channels"] if row is not None else None
        if "enabled" in body:
            if not isinstance(body["enabled"], bool):
                raise bad("enabled: a boolean")
            enabled = body["enabled"]
        if "params" in body:
            params = {**params, **_check_params(reg, body["params"])}
        if "channels" in body:
            wanted = body["channels"]
            allowed = type_channels(reg)
            if not isinstance(wanted, list) or any(c not in allowed for c in wanted):
                raise bad(f"channels: a subset of {allowed}")
            channels = list(dict.fromkeys(wanted))
        saved = await conn.fetchrow(
            "INSERT INTO notify_topic_config (key, enabled, params, channels, config_version)"
            " VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, key) DO UPDATE SET"
            " enabled = $2, params = $3, channels = $4, config_version = $5 RETURNING *",
            key,
            enabled,
            json.dumps(params),
            channels,
            current + 1,
        )
        result = {"topic_type": reg, "config": effective(reg, saved, d.settings if ready else None)}
    await d.audit.append(
        ctx["tenant_id"], session.user_id, "notify.topic.configured", {"type": "topic", "id": key}
    )
    return JSONResponse(result)


def topic_info(reg: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    scopes: dict[str, Any] = {}
    parts: dict[str, Any] = {}
    for name, part in reg["parts"].items():
        channels = [c for c in part["channels"] if c in config["channels"]]
        info: dict[str, Any] = {
            "scope": part["scope"],
            "channels": channels,
            "defaults": {c: v for c, v in part["defaults"].items() if c in channels},
        }
        if part["scope"] == "entity":
            info["entity_type"] = part["entity"]["type"]
        scopes[name] = info
        default = bool(info["defaults"].get("push", False))
        parts[name] = (
            {"default": default, "needs_sign_in": True}
            if name == "personal"
            else {"default": default}
        )
    return {
        "topic": reg["key"],
        "title": reg["title"],
        "owner": reg["owner"],
        "custom": False,
        "scopes": scopes,
        "parts": parts,
    }


async def list_topics(request: Request) -> Response:
    """The topics this event offers; for anyone the event's info-page mode lets in."""
    ctx = await tenant_ctx(request)
    if await session_of(request) is None:
        check_info_access(ctx, client_ip=client_ip(request), viewer="guest")
    d = deps(request)
    ready = await settings_ready(d.settings)
    async with d.db.tenant() as conn:
        found = await configured(conn, d.settings if ready else None)
    topics = [
        topic_info(v["topic_type"], v["config"]) for v in found.values() if v["config"]["enabled"]
    ]
    return JSONResponse({"topics": topics})


ROUTES = [
    Route("/api/notify/topic-types", list_types, methods=["GET"]),
    Route("/api/notify/topic-types/{topic}/config", configure, methods=["PUT"]),
    Route("/api/notify/topics", list_topics, methods=["GET"]),
]
