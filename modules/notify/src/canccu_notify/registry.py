"""The global topic registry: modules register their topic types at start
(contracts/notify.md, Topic registry and Registering)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from canccu_kit import KitError, ServiceForbidden
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import engine
from .deps import deps

log = logging.getLogger("canccu_notify.registry")
KEY_RE = re.compile(r"[a-z][a-z0-9_]{0,31}")
PATH_RE = re.compile(r"[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*")
EVENT_RE = re.compile(r"[a-z]+(\.[a-z][a-z0-9_]*){2}")
CHANNELS = ("push", "discord_dm")
PART_SCOPES = {"event": {"event"}, "personal": {"user", "entity"}}
TEMPLATE_MAX = {"title": 200, "body": 400, "url": 200}


def bad(message: str) -> KitError:
    return KitError(message, status=400, code="invalid_request")


def not_found() -> KitError:
    return KitError("no such topic", status=404, code="not_found")


async def body_of(request: Request) -> dict[str, Any]:
    try:
        value = await request.json()
    except ValueError as exc:
        raise bad("the body is not JSON") from exc
    if not isinstance(value, dict):
        raise bad("the body must be an object")
    return value


def _path(value: Any, where: str) -> None:
    if not isinstance(value, str) or not PATH_RE.fullmatch(value):
        raise bad(f"{where}: not a path")


def _template(text: Any, field: str, where: str, params: set[str]) -> None:
    if not isinstance(text, str) or len(text) > TEMPLATE_MAX[field]:
        raise bad(f"{where}.{field}: a text of at most {TEMPLATE_MAX[field]} characters")
    for m in engine.TEMPLATE_RE.finditer(text):
        if m.group(2) is not None and m.group(2) not in engine.FORMATTERS:
            raise bad(f"{where}.{field}: unknown formatter {m.group(2)}")
        if m.group(1).startswith("param.") and m.group(1).removeprefix("param.") not in params:
            raise bad(f"{where}.{field}: unknown parameter {m.group(1)}")


def check_conditions(conds: Any, where: str, params: set[str]) -> None:
    if not isinstance(conds, list):
        raise bad(f"{where}: a list of conditions")
    for i, c in enumerate(conds):
        at = f"{where}[{i}]"
        if not isinstance(c, dict) or c.get("op") not in engine.OPS:
            raise bad(f"{at}: unknown op")
        _path(c.get("field"), f"{at}.field")
        if "param" in c and c["param"] not in params:
            raise bad(f"{at}: unknown parameter {c['param']}")
        if c["op"] == "nearest_in":
            _path(c.get("list"), f"{at}.list")
            if "param" not in c and engine._number(c.get("value")) is None:
                raise bad(f"{at}: nearest_in needs a param or a number")


def _part(name: str, part: Any) -> None:
    where = f"parts.{name}"
    if not isinstance(part, dict) or part.get("scope") not in PART_SCOPES[name]:
        raise bad(f"{where}.scope: not allowed for this part")
    channels = part.get("channels")
    if not isinstance(channels, list) or len(set(channels)) != len(channels):
        raise bad(f"{where}.channels: a list without repeats")
    if any(c not in CHANNELS for c in channels):
        raise bad(f"{where}.channels: unknown channel")
    defaults = part.get("defaults")
    if not isinstance(defaults, dict) or any(
        k not in channels or not isinstance(v, bool) for k, v in defaults.items()
    ):
        raise bad(f"{where}.defaults: booleans for the part's channels")
    if part["scope"] == "entity":
        entity = part.get("entity")
        if not isinstance(entity, dict) or not KEY_RE.fullmatch(str(entity.get("type", ""))):
            raise bad(f"{where}.entity.type: required for scope entity")


def _params(raw: Any) -> set[str]:
    if raw is None:
        return set()
    if not isinstance(raw, list):
        raise bad("params: a list")
    keys: set[str] = set()
    for p in raw:
        if not isinstance(p, dict) or not KEY_RE.fullmatch(str(p.get("key", ""))):
            raise bad("params: each needs a key")
        kind: Any = p.get("type")
        default: Any = p.get("default")
        ok = {
            "integer": isinstance(default, int) and not isinstance(default, bool),
            "boolean": isinstance(default, bool),
            "string": isinstance(default, str),
        }.get(str(kind), False)
        if not ok:
            raise bad(f"params.{p['key']}: the default must have the parameter's type")
        if kind == "integer":
            low, high = p.get("min", default), p.get("max", default)
            if not all(isinstance(v, int) and not isinstance(v, bool) for v in (low, high)):
                raise bad(f"params.{p['key']}: min and max are integers")
            if not int(low) <= int(default) <= int(high):
                raise bad(f"params.{p['key']}: the default is outside min and max")
        keys.add(p["key"])
    return keys


def _trigger(i: int, t: Any, reg: dict[str, Any], params: set[str]) -> None:
    where = f"triggers[{i}]"
    if not isinstance(t, dict) or not EVENT_RE.fullmatch(str(t.get("event", ""))):
        raise bad(f"{where}.event: an event type")
    if t["event"].split(".")[0] != reg["owner"]:
        raise bad(f"{where}.event: a module only turns its own events into notifications")
    part = t.get("part")
    if part not in reg["parts"]:
        raise bad(f"{where}.part: the type has no such part")
    audience = t.get("audience")
    scope = reg["parts"][part]["scope"]
    if part == "event" or scope == "entity":
        if not isinstance(audience, dict) or len(audience) != 1:
            raise bad(f"{where}.audience: a field or a value")
        if "field" in audience:
            _path(audience["field"], f"{where}.audience.field")
        elif audience.get("value") not in engine.PHONE_AUDIENCES:
            raise bad(f"{where}.audience.value: public or attendees")
    recipients = t.get("recipients") or {}
    if part == "personal":
        need = "entity_field" if scope == "entity" else "user_field"
        _path(recipients.get(need), f"{where}.recipients.{need}")
    check_conditions(t.get("where", []), f"{where}.where", params)
    for name in ("channels_field", "expires_at"):
        if name in t:
            _path(t[name], f"{where}.{name}")
    urgent = t.get("urgent", False)
    if not isinstance(urgent, bool):
        if not isinstance(urgent, dict):
            raise bad(f"{where}.urgent: a boolean or a field")
        _path(urgent.get("field"), f"{where}.urgent.field")
    for path in t.get("dedupe_by") or []:
        if path != "audience":
            _path(path, f"{where}.dedupe_by")
    for field in ("title", "body"):
        _template(t.get(field), field, where, params)
    if "url" in t:
        _template(t["url"], "url", where, params)
    minutes = t.get("expires_after_minutes")
    if minutes is not None and (not isinstance(minutes, int) or not 1 <= minutes <= 10080):
        raise bad(f"{where}.expires_after_minutes: 1 to 10080")


def validate(key: str, reg: dict[str, Any]) -> dict[str, Any]:
    """The registration as stored, or 400 invalid_request naming the first problem."""
    if not KEY_RE.fullmatch(key) or key.startswith("custom_"):
        raise bad("key: lowercase snake_case, and custom_ keys are the events' own")
    if reg.get("key", key) != key:
        raise bad("key: differs from the path")
    if not isinstance(reg.get("owner"), str) or not re.fullmatch(r"[a-z]+", reg["owner"]):
        raise bad("owner: a module name")
    title = reg.get("title")
    if not isinstance(title, str) or not 1 <= len(title) <= 60:
        raise bad("title: 1 to 60 characters")
    parts = reg.get("parts")
    if not isinstance(parts, dict) or not parts or set(parts) - set(PART_SCOPES):
        raise bad("parts: event and/or personal")
    for name, part in parts.items():
        _part(name, part)
    params = _params(reg.get("params"))
    triggers = reg.get("triggers")
    if not isinstance(triggers, list) or not triggers:
        raise bad("triggers: at least one")
    for i, t in enumerate(triggers):
        _trigger(i, t, reg, params)
    return {**reg, "key": key}


async def register(request: Request) -> Response:
    key = request.path_params["topic"]
    reg = validate(key, await body_of(request))
    caller = request.state.service
    if caller != reg["owner"]:
        # The kit's identity names the calling module: a module registers only what it owns.
        raise ServiceForbidden(f"module {caller} registers only its own topics")
    d = deps(request)
    async with d.db.platform() as conn:
        row = await conn.fetchrow(
            "SELECT owner, registration FROM notify_topic_types WHERE key = $1 FOR UPDATE", key
        )
        if row is not None and row["owner"] != reg["owner"]:
            raise KitError(f"{key} is registered by {row['owner']}", status=409, code="topic_owned")
        old = json.loads(row["registration"]) if row is not None else None
        if old != reg:  # idempotent: the same registration again changes nothing
            await conn.execute(
                "INSERT INTO notify_topic_types (key, owner, registration) VALUES ($1, $2, $3)"
                " ON CONFLICT (key) DO UPDATE SET registration = $3, updated_at = now()",
                key,
                reg["owner"],
                json.dumps(reg),
            )
            await conn.execute(
                "INSERT INTO notify_topic_type_history (key, owner, old, new)"
                " VALUES ($1, $2, $3, $4)",
                key,
                reg["owner"],
                json.dumps(old) if old is not None else None,
                json.dumps(reg),
            )
            log.info("topic type %s registered by %s (%s)", key, reg["owner"], old and "changed")
    return JSONResponse(reg)


async def load(conn: Any) -> dict[str, dict[str, Any]]:
    """Every registration from the store: a module that is down keeps its topics."""
    rows = await conn.fetch("SELECT key, registration FROM notify_topic_types ORDER BY key")
    return {r["key"]: json.loads(r["registration"]) for r in rows}


ROUTES = [Route("/internal/notify/topic-types/{topic}", register, methods=["PUT"])]
