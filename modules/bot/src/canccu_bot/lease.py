"""The keys the pool keeps in Valkey: a lease per application, so the platform never opens one
token twice (contracts/bot.md, One client per application), and each client's status, so every
container answers for clients another one holds."""

from __future__ import annotations

from collections.abc import Collection
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

    async def take(self, key: str) -> str | None:
        """Read and delete in one step: a single-use value is used once, also by racing
        containers."""
        ...

    async def hash_write(
        self, key: str, values: dict[str, str], gone: Collection[str], ttl_ms: int
    ) -> None:
        """Set and delete fields of a hash and give it `ttl_ms` more, in one round trip."""
        ...

    async def hash_read(self, key: str) -> dict[str, str]: ...

    async def delete(self, *keys: str) -> None: ...

    async def incr(self, key: str, ttl_ms: int) -> int:
        """Count one up; a new counter runs out after `ttl_ms`."""
        ...


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

    async def take(self, key: str) -> str | None:
        value = await self._client.getdel(key)
        return None if value is None else str(value)

    async def hash_write(
        self, key: str, values: dict[str, str], gone: Collection[str], ttl_ms: int
    ) -> None:
        async with self._client.pipeline(transaction=True) as pipe:
            if gone:
                pipe.hdel(key, *gone)
            if values:
                pipe.hset(key, mapping=values)
            pipe.pexpire(key, ttl_ms)
            await pipe.execute()

    async def hash_read(self, key: str) -> dict[str, str]:
        found = await self._client.hgetall(key)  # type: ignore[misc]
        return {str(k): str(v) for k, v in found.items()}

    async def delete(self, *keys: str) -> None:
        if keys:
            await self._client.delete(*keys)

    async def incr(self, key: str, ttl_ms: int) -> int:
        async with self._client.pipeline(transaction=True) as pipe:
            pipe.incr(key)
            pipe.pexpire(key, ttl_ms, nx=True)
            count, _ = await pipe.execute()
        return int(count)

    async def close(self) -> None:
        await self._client.aclose()
