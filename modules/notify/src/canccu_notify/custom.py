"""An event's own topics: a registered topic type narrowed by extra conditions and defaults that
can only switch channels off (contracts/notify.md, Custom topics). Pure, apart from `rows`."""

from __future__ import annotations

import json
from typing import Any

from . import registry
from .registry import KEY_RE, bad

PREFIX = "custom_"


def _defaults(raw: Any, base: dict[str, Any]) -> dict[str, dict[str, bool]]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise bad("defaults: an object per part")
    out: dict[str, dict[str, bool]] = {}
    for name, switches in raw.items():
        part = base["parts"].get(name)
        if part is None:
            raise bad(f"defaults.{name}: the base has no such part")
        if not isinstance(switches, dict):
            raise bad(f"defaults.{name}: channel switches")
        for channel, on in switches.items():
            if channel not in part["channels"] or not isinstance(on, bool):
                raise bad(f"defaults.{name}.{channel}: a boolean for one of the base's channels")
            # Never opt people into a channel the base does not already default them into.
            if on and part["defaults"].get(channel) is not True:
                raise bad(f"defaults.{name}.{channel}: may be true only where the base's is")
        out[name] = dict(switches)
    return out


def validate(key: str, body: dict[str, Any], regs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """The custom topic as stored, or 400 invalid_request; `regs` are the module topic types."""
    if not key.startswith(PREFIX) or not KEY_RE.fullmatch(key):
        raise bad("key: custom topics have keys starting with custom_, in lowercase snake_case")
    revision = body.get("revision")
    if "revision" in body and (
        not isinstance(revision, int) or isinstance(revision, bool) or revision < 1
    ):
        raise bad("revision: a positive integer")
    base = regs.get(str(body.get("based_on")))
    if base is None:
        raise bad("based_on: a module's topic type")
    title = body.get("title")
    if not isinstance(title, str) or not 1 <= len(title) <= 60:
        raise bad("title: 1 to 60 characters")
    description = body.get("description")
    if description is not None and (not isinstance(description, str) or len(description) > 200):
        raise bad("description: at most 200 characters")
    conditions = body.get("where")
    if not isinstance(conditions, list) or not conditions:
        raise bad("where: at least one condition")
    params = {p["key"] for p in base.get("params") or []}
    registry.check_conditions(conditions, "where", params)
    return {
        "key": key,
        "revision": revision,
        "based_on": base["key"],
        "title": title,
        "description": description or None,
        "defaults": _defaults(body.get("defaults"), base),
        "conditions": conditions,
    }


def derive(base: dict[str, Any], row: Any) -> dict[str, Any]:
    """The custom topic's registration: the base's parts, audiences, recipients, channels,
    parameters and templates, with the custom conditions added to every trigger, so it can only
    ever reach fewer people than its base."""
    defaults = json.loads(row["defaults"])
    conditions = json.loads(row["conditions"])
    parts = {
        name: {**part, "defaults": {**part["defaults"], **defaults.get(name, {})}}
        for name, part in base["parts"].items()
    }
    triggers = [{**t, "where": [*(t.get("where") or []), *conditions]} for t in base["triggers"]]
    reg = {**base, "key": row["key"], "title": row["title"], "parts": parts, "triggers": triggers}
    reg.pop("description", None)
    if row["description"] is not None:
        reg["description"] = row["description"]
    return reg


def block(row: Any) -> dict[str, Any]:
    """The `custom` part of a TopicTypeConfigured."""
    return {
        "based_on": row["based_on"],
        "where": json.loads(row["conditions"]),
        "revision": row["revision"],
    }


async def rows(conn: Any) -> list[Any]:
    return list(await conn.fetch("SELECT * FROM notify_custom_topics ORDER BY key"))
