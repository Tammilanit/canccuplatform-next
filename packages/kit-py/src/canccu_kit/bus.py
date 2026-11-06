"""Event bus on Valkey Streams: `events:<module>`, one field `event` (contracts/admin.md)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any

from .context import get_correlation_id, new_id
from .log import utc_now_iso
from .store import StreamStore

STREAM_MAXLEN = 10000
"""Approximate length each `events:<module>` stream is trimmed to on publish."""

DEDUPE_SIZE = 10000
EVENT_TYPE_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$")
REQUIRED_FIELDS = ("id", "type", "version", "time", "source", "data")

log = logging.getLogger("canccu.kit.bus")


def stream_name(module: str) -> str:
    return f"events:{module}"


class InvalidEventType(ValueError):
    """The event type breaks the naming rule or names another module."""


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

    def to_json(self) -> str:
        body: dict[str, Any] = {
            "id": self.id,
            "type": self.type,
            "version": self.version,
            "time": self.time,
            "source": self.source,
        }
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
    )


Handler = Callable[[Event], Awaitable[None]]


class Bus:
    def __init__(self, store: StreamStore, module: str) -> None:
        self.store = store
        self.module = module

    async def publish(
        self,
        type: str,
        data: dict[str, Any],
        *,
        version: int,
        correlation_id: str | None = None,
    ) -> Event:
        if not EVENT_TYPE_RE.match(type):
            raise InvalidEventType(f"{type!r} is not <module>.<noun>.<past-tense verb>")
        if type.split(".")[0] != self.module:
            raise InvalidEventType(f"{type!r} does not start with this module ({self.module})")
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise ValueError("version must be an integer >= 1")
        event = Event(
            id=new_id(),
            type=type,
            version=version,
            time=utc_now_iso(),
            source=self.module,
            data=data,
            correlation_id=correlation_id or get_correlation_id(),
        )
        await self.store.xadd(
            stream_name(self.module),
            {"event": event.to_json()},
            maxlen=STREAM_MAXLEN,
            approximate=True,
        )
        return event

    def subscribe(
        self,
        modules: Iterable[str],
        handler: Handler,
        *,
        from_id: str = "$",
        block_ms: int = 5000,
    ) -> Subscription:
        return Subscription(self.store, list(modules), handler, from_id, block_ms)


class Subscription:
    """Reads streams in a background task until closed."""

    def __init__(
        self,
        store: StreamStore,
        modules: list[str],
        handler: Handler,
        from_id: str,
        block_ms: int,
    ) -> None:
        self._store = store
        self._handler = handler
        self._block_ms = block_ms
        self._positions = {stream_name(m): from_id for m in modules}
        self._seen: OrderedDict[str, None] = OrderedDict()
        self._task = asyncio.create_task(self._run())

    def _is_duplicate(self, event_id: str) -> bool:
        if event_id in self._seen:
            self._seen.move_to_end(event_id)
            return True
        self._seen[event_id] = None
        if len(self._seen) > DEDUPE_SIZE:
            self._seen.popitem(last=False)
        return False

    async def _run(self) -> None:
        backoff = 0.5
        while True:
            try:
                batches = await self._store.xread(
                    self._positions, block_ms=self._block_ms, count=100
                )
                backoff = 0.5
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("bus read failed; retrying", extra={"retry_in_s": backoff})
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 10.0)
                continue
            for stream, entries in batches:
                for entry_id, fields in entries:
                    self._positions[stream] = entry_id
                    await self._deliver(stream, entry_id, fields)

    async def _deliver(self, stream: str, entry_id: str, fields: dict[str, str]) -> None:
        try:
            event = parse_envelope(fields.get("event", ""))
        except InvalidEnvelope as exc:
            log.warning(
                "skipped invalid event",
                extra={"stream": stream, "entry": entry_id, "reason": str(exc)},
            )
            return
        if self._is_duplicate(event.id):
            return
        try:
            await self._handler(event)
        except Exception:
            log.exception("event handler failed", extra={"event_id": event.id, "type": event.type})

    async def close(self) -> None:
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
