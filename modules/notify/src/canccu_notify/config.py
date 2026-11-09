"""Each event's configuration of the topic types (contracts/notify.md, Per-event configuration)."""

from __future__ import annotations

import json
import logging
from typing import Any

from canccu_kit import AdminUnavailable, Event, VersionConflict, check_info_access
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import registry
from .access import client_ip, session_of, tenant_ctx, topics_writer
from .deps import Deps, Settings, deps
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


def setting_enabled(key: str, settings: Settings | None) -> bool | None:
    topics = settings.get("topics") if settings is not None else None
    return key in topics if isinstance(topics, list) else None


def setting_lead(settings: Settings | None) -> int | None:
    lead = settings.get("schedule_lead_minutes") if settings is not None else None
    return lead if isinstance(lead, int) and not isinstance(lead, bool) else None


def effective(reg: dict[str, Any], row: Any, settings: Settings | None) -> dict[str, Any]:
    """The configuration in effect. The admin settings `topics` and `schedule_lead_minutes` are
    the same values as `enabled` and the `schedule` topic's `lead_minutes` (contracts/notify.md,
    Per-event configuration): whichever was written later wins. A row's value wins while the
    setting still equals what it was when the row was written (`*_seen`); a setting that has
    changed since was written later. `settings` is None while admin is unreachable: the row's
    values then stand."""
    key = reg["key"]
    now_enabled = setting_enabled(key, settings)
    if (
        row is not None
        and row["enabled"] is not None
        and (settings is None or now_enabled == row["enabled_seen"])
    ):
        enabled = row["enabled"]
    else:
        enabled = now_enabled if now_enabled is not None else True
    params = {p["key"]: p["default"] for p in reg.get("params") or []}
    mirrored = key == "schedule" and "lead_minutes" in params
    now_lead = setting_lead(settings)
    if mirrored and now_lead is not None:
        params["lead_minutes"] = now_lead
    if row is not None:
        own = json.loads(row["params"])
        if mirrored and settings is not None and now_lead != row["lead_seen"]:
            own.pop("lead_minutes", None)
        params.update(own)
    channels = type_channels(reg)
    if row is not None and row["channels"] is not None:
        channels = [c for c in channels if c in row["channels"]]
    return {
        "config_version": row["config_version"] if row is not None else 0,
        "enabled": enabled,
        "params": params,
        "channels": channels,
    }


async def on_admin_event(d: Deps, event: Event) -> None:
    """The settings `topics` and `schedule_lead_minutes` written in admin replace the event's own
    `enabled` and `lead_minutes`: the later write wins, also when a setting returns to an earlier
    value (effective() alone could not tell). The version goes up, so a config form opened
    before is stale."""
    if (
        event.type != "admin.settings.changed"
        or event.data.get("module") != "notify"
        or event.tenant is None
    ):
        return
    keys = event.data.get("keys")
    keys = keys if isinstance(keys, list) else ["topics", "schedule_lead_minutes"]
    async with d.db.tenant(event.tenant) as conn:
        if "topics" in keys:
            await conn.execute(
                "UPDATE notify_topic_config SET enabled = NULL, enabled_seen = NULL,"
                " config_version = config_version + 1 WHERE enabled IS NOT NULL"
            )
        if "schedule_lead_minutes" in keys:
            await conn.execute(
                "UPDATE notify_topic_config SET params = params - 'lead_minutes',"
                " lead_seen = NULL, config_version = config_version + 1"
                " WHERE key = 'schedule' AND params ? 'lead_minutes'"
            )


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
    session = await topics_writer(request, write=True)
    key = request.path_params["topic"]
    body = await body_of(request)
    version = body.get("config_version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 0:
        raise bad("config_version: required")
    d = deps(request)
    ctx = await tenant_ctx(request)
    # A write records the settings it saw (effective()), so it needs them: no write while admin
    # is unreachable, as in the agenda.
    await d.settings.ensure()
    async with d.db.tenant() as conn:
        regs = await registry.load(conn)
        reg = regs.get(key)
        if reg is None:
            raise not_found()
        row = await conn.fetchrow("SELECT * FROM notify_topic_config WHERE key = $1", key)
        current = row["config_version"] if row is not None else 0
        if version != current:
            raise VersionConflict(f"config_version is {current}")
        enabled = row["enabled"] if row is not None else None
        enabled_seen = row["enabled_seen"] if row is not None else None
        params = json.loads(row["params"]) if row is not None else {}
        lead_seen = row["lead_seen"] if row is not None else None
        channels = row["channels"] if row is not None else None
        if "enabled" in body:
            if not isinstance(body["enabled"], bool):
                raise bad("enabled: a boolean")
            enabled = body["enabled"]
            enabled_seen = setting_enabled(key, d.settings)
        if "params" in body:
            given = _check_params(reg, body["params"])
            params = {**params, **given}
            if key == "schedule" and "lead_minutes" in given:
                lead_seen = setting_lead(d.settings)
        if "channels" in body:
            wanted = body["channels"]
            allowed = type_channels(reg)
            if not isinstance(wanted, list) or any(c not in allowed for c in wanted):
                raise bad(f"channels: a subset of {allowed}")
            channels = list(dict.fromkeys(wanted))
        values = (key, enabled, enabled_seen, json.dumps(params), lead_seen, channels, current + 1)
        # The version is checked by the write itself: two first writes with config_version 0, or
        # two updates of the same version, cannot both succeed.
        if row is None:
            saved = await conn.fetchrow(
                "INSERT INTO notify_topic_config (key, enabled, enabled_seen, params, lead_seen,"
                " channels, config_version) VALUES ($1, $2, $3, $4, $5, $6, $7)"
                " ON CONFLICT (tenant_id, key) DO NOTHING RETURNING *",
                *values,
            )
        else:
            saved = await conn.fetchrow(
                "UPDATE notify_topic_config SET enabled = $2, enabled_seen = $3, params = $4,"
                " lead_seen = $5, channels = $6, config_version = $7"
                " WHERE key = $1 AND config_version = $8 RETURNING *",
                *values,
                current,
            )
        if saved is None:
            raise VersionConflict("changed by someone else; reload")
        result = {"topic_type": reg, "config": effective(reg, saved, d.settings)}
        # Inside the transaction: a change whose audit entry cannot be written is rolled back.
        await d.audit.append(
            ctx["tenant_id"],
            session.user_id,
            "notify.topic.configured",
            {"type": "topic", "id": key},
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
