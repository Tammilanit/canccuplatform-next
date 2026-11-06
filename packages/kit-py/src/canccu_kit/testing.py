"""Test helpers for modules that use the kit: an in-memory StreamStore."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from .store import StreamEntries


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

    async def ping(self) -> bool:
        if not self.healthy:
            raise ConnectionError("valkey unreachable")
        return True

    async def close(self) -> None:
        return None
