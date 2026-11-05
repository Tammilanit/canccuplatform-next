"""The small Valkey Streams surface the kit needs, and its real implementation."""

from __future__ import annotations

from typing import Protocol

import valkey.asyncio as valkey

StreamEntries = list[tuple[str, list[tuple[str, dict[str, str]]]]]


class StreamStore(Protocol):
    async def xadd(
        self, stream: str, fields: dict[str, str], *, maxlen: int, approximate: bool
    ) -> str: ...

    async def xread(
        self, streams: dict[str, str], *, block_ms: int, count: int
    ) -> StreamEntries: ...

    async def ping(self) -> bool: ...

    async def close(self) -> None: ...


class ValkeyStreamStore:
    """StreamStore backed by valkey-py (asyncio)."""

    def __init__(self, client: valkey.Valkey) -> None:
        self._client = client

    @classmethod
    def from_url(cls, url: str) -> ValkeyStreamStore:
        return cls(valkey.Valkey.from_url(url, decode_responses=True))

    async def xadd(
        self, stream: str, fields: dict[str, str], *, maxlen: int, approximate: bool
    ) -> str:
        entry_id = await self._client.xadd(stream, fields, maxlen=maxlen, approximate=approximate)
        return str(entry_id)

    async def xread(self, streams: dict[str, str], *, block_ms: int, count: int) -> StreamEntries:
        result = await self._client.xread(streams, count=count, block=block_ms)
        return [
            (str(stream), [(str(entry_id), dict(fields)) for entry_id, fields in entries])
            for stream, entries in (result or [])
        ]

    async def ping(self) -> bool:
        return bool(await self._client.ping())

    async def close(self) -> None:
        await self._client.aclose()
