"""The small Valkey Streams surface the kit needs, and its real implementation."""

from __future__ import annotations

from typing import Protocol

import valkey.asyncio as valkey

StreamEntries = list[tuple[str, list[tuple[str, dict[str, str]]]]]

READ_TIMEOUT_S = 30.0
"""valkey-py's socket timeout defaults to 5 s, as long as the bus's blocking XREAD: the read then
races the timeout and fails every few seconds. It must outlast every block with room to spare."""
BLOCK_MARGIN_S = 5.0


class StreamStore(Protocol):
    async def xadd(
        self, stream: str, fields: dict[str, str], *, maxlen: int, approximate: bool
    ) -> str: ...

    async def xread(
        self, streams: dict[str, str], *, block_ms: int, count: int
    ) -> StreamEntries: ...

    async def last_entry_id(self, stream: str) -> str:
        """The id of a stream's newest entry, or `0-0` when the stream is empty or missing."""
        ...

    async def scan(self, pattern: str) -> list[str]:
        """Names of the streams matching a glob pattern, e.g. `t:*:events:pizza`."""
        ...

    async def ping(self) -> bool: ...

    async def close(self) -> None: ...


class ValkeyStreamStore:
    """StreamStore backed by valkey-py (asyncio)."""

    def __init__(self, client: valkey.Valkey, read_timeout_s: float | None = None) -> None:
        self._client = client
        self._read_timeout_s = read_timeout_s

    @classmethod
    def from_url(cls, url: str, *, read_timeout_s: float = READ_TIMEOUT_S) -> ValkeyStreamStore:
        client = valkey.Valkey.from_url(url, decode_responses=True, socket_timeout=read_timeout_s)
        return cls(client, read_timeout_s)

    async def xadd(
        self, stream: str, fields: dict[str, str], *, maxlen: int, approximate: bool
    ) -> str:
        entry_id = await self._client.xadd(stream, fields, maxlen=maxlen, approximate=approximate)
        return str(entry_id)

    async def xread(self, streams: dict[str, str], *, block_ms: int, count: int) -> StreamEntries:
        if self._read_timeout_s is not None and block_ms / 1000 + BLOCK_MARGIN_S > (
            self._read_timeout_s
        ):
            raise ValueError("block_ms must stay well below the Valkey read timeout")
        result = await self._client.xread(streams, count=count, block=block_ms)
        return [
            (str(stream), [(str(entry_id), dict(fields)) for entry_id, fields in entries])
            for stream, entries in (result or [])
        ]

    async def last_entry_id(self, stream: str) -> str:
        newest = await self._client.xrevrange(stream, count=1)
        return str(newest[0][0]) if newest else "0-0"

    async def scan(self, pattern: str) -> list[str]:
        # A SCAN may return a key more than once while the keyspace is rehashed.
        found: dict[str, None] = {}
        async for key in self._client.scan_iter(match=pattern, count=1000, _type="stream"):
            found[str(key)] = None
        return list(found)

    async def ping(self) -> bool:
        return bool(await self._client.ping())

    async def close(self) -> None:
        await self._client.aclose()
