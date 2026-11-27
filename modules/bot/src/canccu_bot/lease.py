"""The keys the pool keeps in Valkey: a lease per application, so the platform never opens one
token twice (contracts/bot.md, One client per application), and each client's status, so every
container answers for clients another one holds."""

from __future__ import annotations

from typing import Protocol

import valkey.asyncio as valkey

# Only the holder may extend or end its lease: checked and changed in one step on the server, so a
# lease that ran out and was taken by another container is never extended or deleted by the old one.
_RENEW = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
"""
_RELEASE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


def lease_key(application_id: str) -> str:
    return f"bot:lease:{application_id}"


def status_key(application_id: str) -> str:
    return f"bot:status:{application_id}"


class KeyStore(Protocol):
    async def acquire(self, key: str, holder: str, ttl_ms: int) -> bool: ...

    async def renew(self, key: str, holder: str, ttl_ms: int) -> bool: ...

    async def release(self, key: str, holder: str) -> None: ...

    async def put(self, key: str, value: str, ttl_ms: int) -> None: ...

    async def get(self, key: str) -> str | None: ...


class ValkeyKeys:
    def __init__(self, client: valkey.Valkey) -> None:
        self._client = client

    @classmethod
    def from_url(cls, url: str) -> ValkeyKeys:
        return cls(valkey.Valkey.from_url(url, decode_responses=True))

    async def acquire(self, key: str, holder: str, ttl_ms: int) -> bool:
        return bool(await self._client.set(key, holder, nx=True, px=ttl_ms))

    async def renew(self, key: str, holder: str, ttl_ms: int) -> bool:
        return bool(await self._client.eval(_RENEW, 1, key, holder, str(ttl_ms)))  # type: ignore[misc]

    async def release(self, key: str, holder: str) -> None:
        await self._client.eval(_RELEASE, 1, key, holder)  # type: ignore[misc]

    async def put(self, key: str, value: str, ttl_ms: int) -> None:
        await self._client.set(key, value, px=ttl_ms)

    async def get(self, key: str) -> str | None:
        value = await self._client.get(key)
        return None if value is None else str(value)

    async def close(self) -> None:
        await self._client.aclose()
