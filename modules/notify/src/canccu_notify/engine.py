"""The trigger engine, pure: an event envelope plus a registration in, candidate notifications
out (contracts/notify.md, Topic registry). No I/O, so every rule is a table of fixtures; the
consumer does the dedupe insert and the writes."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

MISSING: Any = object()
TEMPLATE_RE = re.compile(r"\{([a-z_][a-z0-9_.]*)(?:\|([a-z]+))?\}")
FORMATTERS = frozenset({"time", "date", "signed"})
OPS = frozenset({"eq", "ne", "in", "not_in", "exists", "within_minutes", "nearest_in"})
TITLE_MAX, BODY_MAX = 80, 300  # the Notification schema's limits
PERSONAL_EXPIRY = timedelta(hours=12)
PHONE_AUDIENCES = frozenset({"public", "attendees"})
MINUS = "\N{MINUS SIGN}"  # the contract writes a negative offset with it, not a hyphen


def get(envelope: dict[str, Any], path: str) -> Any:
    value: Any = envelope
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return MISSING
        value = value[part]
    return value


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def holds(
    cond: dict[str, Any], envelope: dict[str, Any], params: dict[str, Any], now: datetime
) -> bool:
    """One `where` condition. A missing path makes it false, `ne` and `not_in` included."""
    value = get(envelope, cond["field"])
    if value is MISSING:
        return False
    op = cond["op"]
    if op == "exists":
        return value is not None
    against = params.get(cond["param"], MISSING) if "param" in cond else cond.get("value", MISSING)
    if op in ("eq", "ne"):
        return bool((value == against) == (op == "eq"))
    if op in ("in", "not_in"):
        if not isinstance(against, list):
            return False
        return bool((value in against) == (op == "in"))
    if op == "within_minutes":
        at, minutes = parse_time(value), _number(against)
        if at is None or minutes is None:
            return False
        return now <= at <= now + timedelta(minutes=minutes)
    if op == "nearest_in":
        candidates = get(envelope, cond.get("list", ""))
        target, mine = _number(against), _number(value)
        if not isinstance(candidates, list) or target is None or mine is None:
            return False
        numbers = [n for n in (_number(c) for c in candidates) if n is not None]
        if not numbers:
            return False
        # On a tie the larger: sort by distance, then by the larger value first.
        best = min(numbers, key=lambda n: (abs(n - target), -n))
        return mine == best
    return False


def _format(value: Any, formatter: str | None, tz: ZoneInfo) -> str:
    if value is MISSING or value is None:
        return ""
    if formatter in ("time", "date"):
        at = parse_time(value)
        if at is None:
            return ""
        local = at.astimezone(tz)
        return local.strftime("%H:%M") if formatter == "time" else local.strftime("%Y-%m-%d")
    if formatter == "signed":
        n = _number(value)
        if n is None:
            return ""
        text = str(int(n)) if n == int(n) else str(n)
        return f"+{text}" if n > 0 else text.replace("-", MINUS)
    return str(value)


def fill(template: str, envelope: dict[str, Any], params: dict[str, Any], tz: ZoneInfo) -> str:
    def one(m: re.Match[str]) -> str:
        path, formatter = m.group(1), m.group(2)
        if path.startswith("param."):
            value = params.get(path.removeprefix("param."), MISSING)
        else:
            value = get(envelope, path)
        return _format(value, formatter, tz)

    return TEMPLATE_RE.sub(one, template)


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


@dataclass(frozen=True)
class Candidate:
    """What one trigger makes of one event, before recipients and dedupe."""

    topic: str
    part: str
    audience: str  # public, attendees or personal
    user_ids: tuple[str, ...]
    dedupe_key: str
    title: str
    body: str
    url: str | None
    urgent: bool
    channels: tuple[str, ...]
    expires_at: datetime


def _audience(trigger: dict[str, Any], envelope: dict[str, Any]) -> str | None:
    spec = trigger.get("audience") or {}
    value = spec["value"] if "value" in spec else get(envelope, spec.get("field", ""))
    # crew and system events never reach phones: dropped before anything else.
    return value if value in PHONE_AUDIENCES else None


def _user_ids(trigger: dict[str, Any], envelope: dict[str, Any]) -> tuple[str, ...]:
    raw = get(envelope, (trigger.get("recipients") or {}).get("user_field", ""))
    values = raw if isinstance(raw, list) else [raw]
    # Only user ids: null and anything else are dropped; never a Person or a name.
    return tuple(dict.fromkeys(v for v in values if isinstance(v, str) and v))


def evaluate(
    topic: str,
    trigger: dict[str, Any],
    allowed_channels: list[str],
    params: dict[str, Any],
    envelope: dict[str, Any],
    now: datetime,
    tz: ZoneInfo,
) -> list[Candidate]:
    """The trigger's candidates for one event; `allowed_channels` is the type's channels for the
    part narrowed by the event's configuration. Empty when any check fails."""
    if trigger["event"] != envelope.get("type"):
        return []
    part = trigger["part"]
    if part == "event" or "entity_field" in (trigger.get("recipients") or {}):
        audience = _audience(trigger, envelope)
        if audience is None:
            return []
    else:
        audience = "personal"
    if not all(holds(c, envelope, params, now) for c in trigger.get("where") or []):
        return []
    channels = list(allowed_channels)
    if "channels_field" in trigger:
        named = get(envelope, trigger["channels_field"])
        named = named if isinstance(named, list) else []
        channels = [c for c in channels if c in named]
    if not channels:
        return []
    if "entity_field" in (trigger.get("recipients") or {}):
        return []  # followers arrive with follows (#226); until then nobody follows anything
    user_ids: tuple[str, ...] = ()
    if part == "personal":
        user_ids = _user_ids(trigger, envelope)
        if not user_ids:
            return []
    key_parts = []
    for path in trigger.get("dedupe_by") or ["id"]:
        value = audience if path == "audience" else get(envelope, path)
        key_parts.append(str(envelope.get("id") if value in (MISSING, None) else value))
    urgent_spec = trigger.get("urgent", False)
    urgent = (
        get(envelope, urgent_spec["field"]) is True
        if isinstance(urgent_spec, dict)
        else urgent_spec is True
    )
    if "expires_at" in trigger:
        expires = parse_time(get(envelope, trigger["expires_at"])) or now + PERSONAL_EXPIRY
    elif "expires_after_minutes" in trigger:
        expires = now + timedelta(minutes=trigger["expires_after_minutes"])
    else:
        expires = now + PERSONAL_EXPIRY
    url = fill(trigger["url"], envelope, params, tz) if trigger.get("url") else None
    return [
        Candidate(
            topic=topic,
            part=part,
            audience=audience,
            user_ids=user_ids,
            dedupe_key="\x1f".join([topic, *key_parts]),
            title=_cut(fill(trigger["title"], envelope, params, tz), TITLE_MAX),
            body=_cut(fill(trigger["body"], envelope, params, tz), BODY_MAX),
            url=url,
            urgent=urgent,
            channels=tuple(channels),
            expires_at=expires,
        )
    ]
