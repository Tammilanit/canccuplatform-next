"""Event bus on Valkey Streams, one field `event` (contracts/admin.md).

Tenant events go to `t:<tenant>:events:<module>`, platform events to `events:<module>`
(contracts/events.md).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any

from .context import get_correlation_id, new_id
from .log import utc_now_iso
from .store import StreamStore
from .tenant import (
    NoTenant,
    current_tenant,
    is_tenant_id,
    platform_stream,
    tenant_scope,
    tenant_stream,
)

STREAM_MAXLEN = 10000
"""Approximate length each `events:<module>` stream is trimmed to on publish."""

DEDUPE_SIZE = 10000
EVENT_TYPE_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$")
REQUIRED_FIELDS = ("id", "type", "version", "time", "source", "data")

log = logging.getLogger("canccu.kit.bus")


stream_name = platform_stream
"""The platform stream of a module; tenant streams come from `tenant_stream`."""


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
        tenant: str | None = None,
        platform: bool = False,
    ) -> Event:
        """Publish for `tenant` (default: the current tenant), or with `platform=True` for none.

        Only a module whose contract says so emits platform events; without the flag a missing
        tenant is an error, never a silent platform event.
        """
        if not EVENT_TYPE_RE.match(type):
            raise InvalidEventType(f"{type!r} is not <module>.<noun>.<past-tense verb>")
        if type.split(".")[0] != self.module:
            raise InvalidEventType(f"{type!r} does not start with this module ({self.module})")
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise ValueError("version must be an integer >= 1")
        if platform and tenant is not None:
            raise ValueError("a platform event has no tenant")
        target = None if platform else (tenant if tenant is not None else current_tenant())
        if not platform and target is None:
            raise NoTenant()
        stream = (
            platform_stream(self.module) if target is None else tenant_stream(self.module, target)
        )
        event = Event(
            id=new_id(),
            type=type,
            version=version,
            time=utc_now_iso(),
            source=self.module,
            data=data,
            correlation_id=correlation_id or get_correlation_id(),
            tenant=target,
        )
        await self.store.xadd(
            stream, {"event": event.to_json()}, maxlen=STREAM_MAXLEN, approximate=True
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
        """Read other modules' platform streams `events:<module>`."""
        streams = {platform_stream(m): from_id for m in modules}
        return Subscription(self.store, streams, handler, block_ms)

    def subscribe_tenants(
        self,
        modules: Iterable[str],
        handler: Handler,
        *,
        from_id: str = "$",
        block_ms: int = 5000,
        rescan_ms: int = 30000,
    ) -> TenantSubscription:
        """Read other modules' tenant streams for every tenant, now and later (0013 item 7).

        The handler runs inside tenant_scope(event.tenant). Streams that exist at start begin at
        `from_id`; a tenant found later (tenants.tenant.created, or a rescan) is read from its
        start.
        """
        return TenantSubscription(
            self.store,
            list(modules),
            handler,
            from_id=from_id,
            block_ms=block_ms,
            rescan_ms=rescan_ms,
        )


class Subscription:
    """Reads streams in a background task until closed."""

    def __init__(
        self,
        store: StreamStore,
        streams: dict[str, str],
        handler: Handler,
        block_ms: int,
    ) -> None:
        self._store = store
        self._handler = handler
        self._block_ms = block_ms
        self._positions = dict(streams)
        self._seen: OrderedDict[str, None] = OrderedDict()
        # The task first runs at the caller's next await, after a subclass's __init__ is done.
        self._task = asyncio.create_task(self._run())

    def _is_duplicate(self, event_id: str) -> bool:
        if event_id in self._seen:
            self._seen.move_to_end(event_id)
            return True
        self._seen[event_id] = None
        if len(self._seen) > DEDUPE_SIZE:
            self._seen.popitem(last=False)
        return False

    async def _before_read(self) -> None:
        """Called before every read."""

    async def _dispatch(self, stream: str, event: Event) -> None:
        """Hand one parsed, new event to the handler."""
        await self._handler(event)

    async def _run(self) -> None:
        backoff = 0.5
        while True:
            try:
                await self._before_read()
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
                    # A stream removed while its batch was in flight stays removed.
                    if stream not in self._positions:
                        break
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
            await self._dispatch(stream, event)
        except Exception:
            log.exception("event handler failed", extra={"event_id": event.id, "type": event.type})

    async def close(self) -> None:
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass


_TENANT_STREAM_RE = re.compile(r"t:([^:]+):events:([^:]+)")
_TENANTS_PLATFORM = platform_stream("tenants")


class TenantSubscription(Subscription):
    """Tenant streams of some modules, for every tenant; see Bus.subscribe_tenants."""

    def __init__(
        self,
        store: StreamStore,
        modules: list[str],
        handler: Handler,
        *,
        from_id: str,
        block_ms: int,
        rescan_ms: int,
    ) -> None:
        for module in modules:
            # Checked here, not at the first scan: a bad name would fail every read, forever.
            platform_stream(module)
        self._modules = modules
        self._rescan_s = rescan_ms / 1000
        self._scan_from = from_id
        self._last_scan = float("-inf")
        self._deleted: set[str] = set()
        # The tenants platform stream announces new and deleted tenants.
        super().__init__(store, {_TENANTS_PLATFORM: "$"}, handler, block_ms)

    def _add_tenant(self, tenant: str, from_id: str) -> None:
        if not is_tenant_id(tenant) or tenant in self._deleted:
            return
        for module in self._modules:
            self._positions.setdefault(tenant_stream(module, tenant), from_id)

    async def _before_read(self) -> None:
        if time.monotonic() - self._last_scan < self._rescan_s:
            return
        self._last_scan = time.monotonic()
        for module in self._modules:
            for stream in await self._store.scan(f"t:*:events:{module}"):
                found = _TENANT_STREAM_RE.fullmatch(stream)
                if found is not None:
                    self._add_tenant(found.group(1), self._scan_from)
        # Only streams there at start may skip their history; any found later is new to us.
        self._scan_from = "0"

    async def _dispatch(self, stream: str, event: Event) -> None:
        if stream == _TENANTS_PLATFORM:
            tenant = event.data.get("tenant_id")
            if not isinstance(tenant, str) or not is_tenant_id(tenant):
                return
            if event.type == "tenants.tenant.created":
                self._add_tenant(tenant, "0")
            if event.type == "tenants.tenant.deleted":
                self._deleted.add(tenant)
                for module in self._modules:
                    self._positions.pop(tenant_stream(module, tenant), None)
            return
        found = _TENANT_STREAM_RE.fullmatch(stream)
        if found is None or event.tenant != found.group(1):
            log.warning(
                "dropped event of another tenant",
                extra={"stream": stream, "event_id": event.id, "tenant": event.tenant},
            )
            return
        with tenant_scope(found.group(1)):
            await self._handler(event)
