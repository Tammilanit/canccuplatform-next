"""Field rules and the JSON shapes of items and kinds (contracts/agenda.openapi.yaml)."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from canccu_kit import KitError

# The starter set a new event begins with (contracts/agenda.md, Kinds), in display order.
STARTER_KINDS: tuple[tuple[str, str], ...] = (
    ("doors", "Doors"),
    ("ceremony", "Ceremony"),
    ("tournament", "Tournament"),
    ("meal", "Meal"),
    ("quiet_hours", "Quiet hours"),
    ("activity", "Activity"),
    ("other", "Other"),
)
BUILTIN = frozenset(key for key, _ in STARTER_KINDS)
CHANNELS = ("screen", "discord_channel", "discord_dm", "push")
VISIBILITIES = ("public", "attendees", "crew")
DEFAULT_LEADS = (30, 10)
DEFAULT_CHANNELS = ("screen", "discord_channel", "push")

KIND_RE = re.compile(r"[a-z][a-z0-9_]{0,31}")
ZONE_RE = re.compile(r"[a-z0-9_]{1,32}")
ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")


def invalid(message: str) -> KitError:
    return KitError(message, status=400, code="invalid_request")


def conflict(code: str, message: str) -> KitError:
    return KitError(message, status=409, code=code)


def parse_time(value: Any, field: str) -> datetime:
    """RFC 3339 with an offset; a naive time would be read in the server's zone, so it is 400."""
    if not isinstance(value, str):
        raise invalid(f"{field} must be an RFC 3339 time")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise invalid(f"{field} must be an RFC 3339 time") from None
    if parsed.tzinfo is None:
        raise invalid(f"{field} needs a time zone offset")
    return parsed.astimezone(UTC)


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def text(value: Any, field: str, max_len: int, *, required: bool = False) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str) or (required and not value.strip()) or len(value) > max_len:
        raise invalid(f"{field} must be text of at most {max_len} characters")
    return value


def kind_key(value: Any) -> str:
    if not isinstance(value, str) or not KIND_RE.fullmatch(value):
        raise invalid("kind must be lowercase snake_case, 1-32 characters")
    return value


def zone(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not ZONE_RE.fullmatch(value):
        raise invalid("zone must be a zone key")
    return value


def visibility(value: Any) -> str:
    if value not in VISIBILITIES:
        raise invalid("visibility must be public, attendees or crew")
    return str(value)


def leads(value: Any, field: str = "reminder_leads_minutes") -> list[int] | None:
    if value is None:
        return None
    ok = isinstance(value, list) and len(value) <= 8
    ok = ok and all(type(v) is int and 1 <= v <= 1440 for v in value)
    if not ok:
        raise invalid(f"{field} must be null or at most 8 whole minutes, 1-1440")
    return list(value)


def channels(value: Any, field: str = "notify") -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list) or any(v not in CHANNELS for v in value):
        raise invalid(f"{field} must be null or a list of {', '.join(CHANNELS)}")
    if len(set(value)) != len(value):
        raise invalid(f"{field} must not repeat a channel")
    return list(value)


def revision(value: Any) -> int:
    if type(value) is not int or value < 1:
        raise invalid("revision must be a whole number of at least 1")
    return value


def links(value: Any) -> dict[str, str | None]:
    """The organiser's links. `tournament_session_id` is the agenda's own (the session mirror)."""
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise invalid("links must be an object")
    if "tournament_session_id" in value:
        raise invalid("links.tournament_session_id is set by the agenda only")
    unknown = set(value) - {"tournament_id", "moment_id"}
    if unknown:
        raise invalid(f"unknown link {sorted(unknown)[0]}")
    out: dict[str, str | None] = {}
    for key in ("tournament_id", "moment_id"):
        v = value.get(key)
        if v is not None and (not isinstance(v, str) or not ID_RE.fullmatch(v)):
            raise invalid(f"links.{key} must be an id")
        out[key] = v
    return out


def effective_channels(
    item_notify: Sequence[str] | None,
    kind_notify: Sequence[str] | None,
    event_channels: Sequence[str],
) -> list[str]:
    """Item, then kind, then event: the first that is not null wins, so [] silences."""
    for choice in (item_notify, kind_notify):
        if choice is not None:
            return list(choice)
    return list(event_channels)


def kind_json(row: Mapping[str, Any]) -> dict[str, Any]:
    leads_value = row["reminder_leads_minutes"]
    notify_value = row["notify"]
    return {
        "key": row["key"],
        "name": row["name"],
        "builtin": row["builtin"],
        "reminder_leads_minutes": None if leads_value is None else list(leads_value),
        "notify": None if notify_value is None else list(notify_value),
        "revision": row["revision"],
    }


def item_json(
    row: Mapping[str, Any],
    kinds: Mapping[str, Mapping[str, Any]],
    event_channels: Sequence[str],
) -> dict[str, Any]:
    kind = kinds.get(row["kind"])
    item_notify = None if row["notify"] is None else list(row["notify"])
    item_leads = row["reminder_leads_minutes"]
    delay = int((row["starts_at"] - row["planned_starts_at"]).total_seconds() // 60)
    out: dict[str, Any] = {
        "id": row["id"],
        "title": row["title"],
        "kind": row["kind"],
        "starts_at": iso(row["starts_at"]),
        "ends_at": iso(row["ends_at"]),
        "planned_starts_at": iso(row["planned_starts_at"]),
        "planned_ends_at": iso(row["planned_ends_at"]),
        "delay_minutes": delay,
        "visibility": row["visibility"],
        "status": row["status"],
        "reminder_leads_minutes": None if item_leads is None else list(item_leads),
        "notify": item_notify,
        "notify_channels": effective_channels(
            item_notify, None if kind is None else kind["notify"], event_channels
        ),
        "links": {
            k: row[k]
            for k in ("tournament_id", "tournament_session_id", "moment_id")
            if row[k] is not None
        },
        "revision": row["revision"],
    }
    for key in ("description", "location", "zone", "managed_by", "cloned_from"):
        if row[key] is not None:
            out[key] = row[key]
    return out
