"""Test helpers for modules that use the kit: an in-memory StreamStore and leak tests."""

from __future__ import annotations

import asyncio
import fnmatch
import json
from dataclasses import dataclass, field
from typing import Any, Protocol

from .bus import Event, Handler
from .context import new_id
from .log import utc_now_iso
from .store import StreamEntries
from .tenant import tenant_scope


@dataclass
class XAddCall:
    stream: str
    fields: dict[str, str]
    maxlen: int
    approximate: bool


@dataclass
class MemoryStreamStore:
    """Keeps streams in memory and records every xadd call (trimming is recorded, not applied)."""

    streams: dict[str, list[tuple[str, dict[str, str]]]] = field(default_factory=dict)
    calls: list[XAddCall] = field(default_factory=list)
    healthy: bool = True
    _seq: int = 0
    _changed: asyncio.Event = field(default_factory=asyncio.Event)

    def _next_id(self) -> str:
        self._seq += 1
        return f"{self._seq}-0"

    def append_raw(self, stream: str, fields: dict[str, str]) -> str:
        """Add an entry without going through the bus (e.g. a malformed one)."""
        entry_id = self._next_id()
        self.streams.setdefault(stream, []).append((entry_id, fields))
        self._changed.set()
        return entry_id

    async def xadd(
        self, stream: str, fields: dict[str, str], *, maxlen: int, approximate: bool
    ) -> str:
        self.calls.append(XAddCall(stream, dict(fields), maxlen, approximate))
        return self.append_raw(stream, dict(fields))

    def _last_id(self, stream: str) -> str:
        entries = self.streams.get(stream)
        return entries[-1][0] if entries else "0-0"

    async def xread(self, streams: dict[str, str], *, block_ms: int, count: int) -> StreamEntries:
        start = {s: (self._last_id(s) if i == "$" else i) for s, i in streams.items()}

        def collect() -> StreamEntries:
            out: StreamEntries = []
            for stream, after in start.items():
                seq = int(after.split("-")[0])
                new = [e for e in self.streams.get(stream, []) if int(e[0].split("-")[0]) > seq]
                if new:
                    out.append((stream, new[:count]))
            return out

        found = collect()
        if found or block_ms <= 0:
            return found
        self._changed.clear()
        try:
            await asyncio.wait_for(self._changed.wait(), block_ms / 1000)
        except TimeoutError:
            return []
        return collect()

    async def last_entry_id(self, stream: str) -> str:
        return self._last_id(stream)

    async def scan(self, pattern: str) -> list[str]:
        return [s for s in self.streams if fnmatch.fnmatchcase(s, pattern)]

    async def ping(self) -> bool:
        if not self.healthy:
            raise ConnectionError("valkey unreachable")
        return True

    async def close(self) -> None:
        return None


def tenant_event(tenant: str, type: str, data: dict[str, Any] | None = None) -> Event:
    """A valid tenant event envelope, as another module would publish it."""
    return Event(
        id=new_id(),
        type=type,
        version=1,
        time=utc_now_iso(),
        source=type.split(".")[0],
        data={} if data is None else data,
        tenant=tenant,
    )


class TenantLeak(AssertionError):
    """One tenant's data reached another (0013 item 8)."""


class IsolationProbe(Protocol):
    async def seed(self, tenant: str, marker: str) -> None:
        """Store data containing `marker` for `tenant`, the way a user or another module would."""
        ...

    async def read(self, tenant: str) -> object:
        """Read as `tenant`, the way a user or consumer would: a body, rows, a file list."""
        ...


def _as_text(value: object) -> str:
    if isinstance(value, str):
        return value
    return "" if value is None else json.dumps(value, default=str)


async def assert_tenant_isolation(
    probe: IsolationProbe, tenants: tuple[str, str] = ("leak-a", "leak-b")
) -> None:
    """The cross-tenant leak test for one endpoint or consumer.

    Each tenant must read back its own marker and never the other's. Seed and read run inside
    tenant_scope; an HTTP probe also sends the tenant's hostname. A read that does not even return
    its own marker fails too, so a probe that reads the wrong thing cannot pass.
    """
    markers = {t: f"leak-marker-{t}-{new_id()}" for t in tenants}
    for tenant, marker in markers.items():
        with tenant_scope(tenant):
            await probe.seed(tenant, marker)
    for tenant in tenants:
        with tenant_scope(tenant):
            text = _as_text(await probe.read(tenant))
        if markers[tenant] not in text:
            raise AssertionError(
                f"{tenant} did not read back its own data, so the leak test proves nothing"
            )
        for other, marker in markers.items():
            if other != tenant and marker in text:
                raise TenantLeak(f"{tenant} can read data of {other}")


async def deliver_as(handler: Handler, event: Event) -> None:
    """Run a consumer's handler the way the bus does: inside the event's tenant."""
    if event.tenant is None:
        raise ValueError("a tenant event needs a tenant")
    with tenant_scope(event.tenant):
        await handler(event)
