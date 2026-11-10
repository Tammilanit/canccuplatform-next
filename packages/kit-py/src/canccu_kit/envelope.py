"""The event envelope of contracts/events.md, and its check on read."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from .tenant import is_tenant_id

EVENT_TYPE_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$")
REQUIRED_FIELDS = ("id", "type", "version", "time", "source", "data")


class InvalidEnvelope(ValueError):
    """A stream entry is not a valid event envelope."""


@dataclass(frozen=True)
class Event:
    id: str
    type: str
    version: int
    time: str
    source: str
    data: dict[str, Any]
    correlation_id: str | None = None
    tenant: str | None = None
    """Set on tenant events, None on platform events."""

    def to_json(self) -> str:
        body: dict[str, Any] = {
            "id": self.id,
            "type": self.type,
            "version": self.version,
            "time": self.time,
            "source": self.source,
        }
        if self.tenant is not None:
            body["tenant"] = self.tenant
        if self.correlation_id is not None:
            body["correlation_id"] = self.correlation_id
        body["data"] = self.data
        return json.dumps(body, separators=(",", ":"))


def parse_envelope(raw: str) -> Event:
    """Parse and check an envelope; unknown fields are ignored."""
    try:
        body = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise InvalidEnvelope("not JSON") from exc
    if not isinstance(body, dict):
        raise InvalidEnvelope("not an object")
    missing = [f for f in REQUIRED_FIELDS if f not in body]
    if missing:
        raise InvalidEnvelope(f"missing field(s): {', '.join(missing)}")
    checks = {
        "id": isinstance(body["id"], str) and body["id"] != "",
        "type": isinstance(body["type"], str) and bool(EVENT_TYPE_RE.match(body["type"])),
        "version": isinstance(body["version"], int)
        and not isinstance(body["version"], bool)
        and body["version"] >= 1,
        "time": isinstance(body["time"], str),
        "source": isinstance(body["source"], str),
        "data": isinstance(body["data"], dict),
        "correlation_id": body.get("correlation_id") is None
        or isinstance(body["correlation_id"], str),
        "tenant": "tenant" not in body
        or (isinstance(body["tenant"], str) and is_tenant_id(body["tenant"])),
    }
    bad = [name for name, ok in checks.items() if not ok]
    if bad:
        raise InvalidEnvelope(f"invalid field(s): {', '.join(bad)}")
    if body["type"].split(".")[0] != body["source"]:
        raise InvalidEnvelope("source does not match the type's module")
    return Event(
        id=body["id"],
        type=body["type"],
        version=body["version"],
        time=body["time"],
        source=body["source"],
        data=body["data"],
        correlation_id=body.get("correlation_id"),
        tenant=body.get("tenant"),
    )
