"""Each event's configuration of the topic types (contracts/notify.md, Per-event configuration)."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

from canccu_kit import AdminError, AdminUnavailable, VersionConflict, check_info_access
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import custom, registry
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


def effective(
    reg: dict[str, Any], row: Any, settings: Settings | None, base: dict[str, Any] | None = None
) -> dict[str, Any]:
    """The configuration in effect; `base` is the base's configuration for a custom topic, whose
    parameters it starts from and whose channels it can only narrow.

    `enabled` and the `schedule` topic's `lead_minutes` live only in admin's settings `topics`
    and `schedule_lead_minutes` (contracts/notify.md, Per-event configuration): a config write
    carries them there (`write_settings`), so writing either way changes both and admin is the one
    owner. Rows written before keep `enabled`, `enabled_seen` and `lead_seen`, which nothing reads.
    `settings` is None while admin is unreachable: the defaults then apply."""
    key = reg["key"]
    now_enabled = setting_enabled(key, settings)
    params = dict(base["params"]) if base is not None else {}
    if base is None:
        params = {p["key"]: p["default"] for p in reg.get("params") or []}
    if row is not None:
        own = json.loads(row["params"])
        if key == "schedule":
            own.pop("lead_minutes", None)
        params.update(own)
    lead = setting_lead(settings)
    if key == "schedule" and "lead_minutes" in params and lead is not None:
        params["lead_minutes"] = lead
    channels = type_channels(reg) if base is None else base["channels"]
    if row is not None and row["channels"] is not None:
        channels = [c for c in channels if c in row["channels"]]
    return {
        "config_version": row["config_version"] if row is not None else 0,
        "enabled": True if now_enabled is None else now_enabled,
        "params": params,
        "channels": channels,
    }


def topics_with(settings: Settings, every: list[str], key: str, on: bool) -> dict[str, list[str]]:
    """The setting `topics` with one topic switched, or nothing when it already says so. Unset
    means every topic, so switching one off writes the list of all the others."""
    current = settings.get("topics")
    listed = list(current) if isinstance(current, list) else list(every)
    wanted = [k for k in listed if k != key] + ([key] if on else [])
    if (key in listed) == on:
        return {}
    return {"topics": wanted}


async def write_settings(d: Deps, user_id: str, values_of: Callable[[], dict[str, Any]]) -> None:
    """Carry a change to admin's settings, inside the caller's transaction: if admin refuses it,
    the change in Notify is rolled back too. A stale `settings_version` means someone wrote the
    settings meanwhile: reload and compute again once, since the values came from the old ones."""
    for attempt in (1, 2):
        values = values_of()
        if not values:
            return
        try:
            await d.settings.write(values, actor_user_id=user_id)
            return
        except AdminError as exc:
            if exc.code != "version_conflict":
                raise
            if attempt == 2:
                raise VersionConflict("admin's settings changed meanwhile; reload") from exc
            await d.settings.load()


async def configured(conn: Any, settings: Settings | None) -> dict[str, dict[str, Any]]:
    """Every registered type and this event's custom topics, with this event's configuration,
    by key. A custom topic whose base is no longer registered is left out."""
    regs = await registry.load(conn)
    rows = {r["key"]: r for r in await conn.fetch("SELECT * FROM notify_topic_config")}
    found = {
        k: {"topic_type": reg, "config": effective(reg, rows.get(k), settings)}
        for k, reg in regs.items()
    }
    for row in await custom.rows(conn):
        base = found.get(row["based_on"])
        if base is None:
            continue
        reg = custom.derive(base["topic_type"], row)
        found[row["key"]] = {
            "topic_type": reg,
            "custom": custom.block(row),
            "config": effective(reg, rows.get(row["key"]), settings, base["config"]),
        }
    return found


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


async def write_config(
    d: Deps, tenant_id: str, user_id: str, key: str, body: dict[str, Any]
) -> dict[str, Any]:
    """`PUT …/config` for the API and the topic pages alike; the caller checked the right."""
    version = body.get("config_version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 0:
        raise bad("config_version: required")
    # `enabled` and `lead_minutes` are written to admin's settings, so a write needs admin: none
    # while it is unreachable, as in the agenda.
    await d.settings.ensure()
    async with d.db.tenant() as conn:
        every = await configured(conn, d.settings)
        found = every.get(key)
        if found is None:
            raise not_found()
        reg = found["topic_type"]
        row = await conn.fetchrow("SELECT * FROM notify_topic_config WHERE key = $1", key)
        current = row["config_version"] if row is not None else 0
        if version != current:
            raise VersionConflict(f"config_version is {current}")
        params = json.loads(row["params"]) if row is not None else {}
        channels = row["channels"] if row is not None else None
        enabled: bool | None = None
        lead: int | None = None
        if "enabled" in body:
            if not isinstance(body["enabled"], bool):
                raise bad("enabled: a boolean")
            enabled = body["enabled"]
        if "params" in body:
            given = _check_params(reg, body["params"])
            if key == "schedule" and "lead_minutes" in given:
                lead = given.pop("lead_minutes")
            params = {**params, **given}
        if "channels" in body:
            wanted = body["channels"]
            allowed = type_channels(reg)
            if not isinstance(wanted, list) or any(c not in allowed for c in wanted):
                raise bad(f"channels: a subset of {allowed}")
            channels = list(dict.fromkeys(wanted))
        values = (key, json.dumps(params), channels, current + 1)
        # The version is checked by the write itself: two first writes with config_version 0, or
        # two updates of the same version, cannot both succeed. A row of before #251 loses its own
        # `enabled` here: admin's setting is the one owner now (effective()).
        if row is None:
            saved = await conn.fetchrow(
                "INSERT INTO notify_topic_config (key, params, channels, config_version)"
                " VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, key) DO NOTHING RETURNING *",
                *values,
            )
        else:
            saved = await conn.fetchrow(
                "UPDATE notify_topic_config SET params = $2, channels = $3, config_version = $4,"
                " enabled = NULL, enabled_seen = NULL, lead_seen = NULL"
                " WHERE key = $1 AND config_version = $5 RETURNING *",
                *values,
                current,
            )
        if saved is None:
            raise VersionConflict("changed by someone else; reload")
        # Inside the transaction: a change whose audit entry cannot be written is rolled back.
        await d.audit.append(
            tenant_id, user_id, "notify.topic.configured", {"type": "topic", "id": key}
        )

        def mirrored() -> dict[str, Any]:
            out: dict[str, Any] = {}
            if enabled is not None:
                out.update(topics_with(d.settings, list(every), key, enabled))
            if lead is not None and lead != setting_lead(d.settings):
                out["schedule_lead_minutes"] = lead
            return out

        await write_settings(d, user_id, mirrored)
        result: dict[str, Any] = (await configured(conn, d.settings))[key]
    return result


async def configure(request: Request) -> Response:
    session = await topics_writer(request, write=True)
    body = await body_of(request)
    ctx = await tenant_ctx(request)
    d = deps(request)
    return JSONResponse(
        await write_config(d, ctx["tenant_id"], session.user_id, request.path_params["topic"], body)
    )


def topic_info(found: dict[str, Any]) -> dict[str, Any]:
    reg, config = found["topic_type"], found["config"]
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
    info = {
        "topic": reg["key"],
        "title": reg["title"],
        "owner": reg["owner"],
        "custom": "custom" in found,
        "scopes": scopes,
        "parts": parts,
    }
    if "description" in reg:
        info["description"] = reg["description"]
    return info


async def list_topics(request: Request) -> Response:
    """The topics this event offers; for anyone the event's info-page mode lets in."""
    ctx = await tenant_ctx(request)
    if await session_of(request) is None:
        check_info_access(ctx, client_ip=client_ip(request), viewer="guest")
    d = deps(request)
    ready = await settings_ready(d.settings)
    async with d.db.tenant() as conn:
        found = await configured(conn, d.settings if ready else None)
    topics = [topic_info(v) for v in found.values() if v["config"]["enabled"]]
    return JSONResponse({"topics": topics})


ROUTES = [
    Route("/api/notify/topic-types", list_types, methods=["GET"]),
    Route("/api/notify/topic-types/{topic}/config", configure, methods=["PUT"]),
    Route("/api/notify/topics", list_topics, methods=["GET"]),
]
