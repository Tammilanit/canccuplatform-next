"""The live state per event in Valkey (step 6 plan, D2; docs/plans/issue-122.md): who is online
with which "playing" activities, who is in which voice channel, the guild's member count and its
channels, each a hash keyed by Discord id or channel id. Never a name, and never on Postgres: it is
presence data, dropped when the event is archived (contracts/bot.md, Who plays what: Live only).

It lives in Valkey, not in the container, so a restart or a lease moving to another container
loses nothing; GUILD_CREATE rebuilds it after a reconnect that could not resume."""

from __future__ import annotations

from typing import Protocol

import valkey.asyncio as valkey

PARTS = ("presence", "voice", "members", "bots", "guild", "channels")


def live_key(tenant: str, part: str) -> str:
    return f"bot:live:{tenant}:{part}"


class LiveStore(Protocol):
    async def replace(self, key: str, mapping: dict[str, str]) -> None:
        """The hash becomes exactly `mapping`, in one step."""
        ...

    async def hset(self, key: str, field_: str, value: str) -> None: ...

    async def hdel(self, key: str, *fields: str) -> None: ...

    async def hgetall(self, key: str) -> dict[str, str]: ...

    async def hincr(self, key: str, field_: str, by: int) -> int: ...

    async def incr(self, key: str, ttl_ms: int) -> int:
        """+1, the key expiring `ttl_ms` after its first count."""
        ...

    async def mget(self, keys: list[str]) -> list[str | None]: ...

    async def get(self, key: str) -> str | None: ...

    async def put(self, key: str, value: str, ttl_ms: int) -> None: ...

    async def delete(self, *keys: str) -> None: ...


async def clear(store: LiveStore, tenant: str, parts: tuple[str, ...] = PARTS) -> None:
    """The event's live state goes: archived, unbound, deleted, or a feed switched off."""
    await store.delete(*(live_key(tenant, p) for p in parts))


class ValkeyLive:
    def __init__(self, client: valkey.Valkey) -> None:
        self._client = client

    @classmethod
    def from_url(cls, url: str) -> ValkeyLive:
        return cls(valkey.Valkey.from_url(url, decode_responses=True))

    async def replace(self, key: str, mapping: dict[str, str]) -> None:
        async with self._client.pipeline(transaction=True) as pipe:
            pipe.delete(key)
            if mapping:
                pipe.hset(key, mapping=mapping)  # type: ignore[arg-type]
            await pipe.execute()

    async def hset(self, key: str, field_: str, value: str) -> None:
        await self._client.hset(key, field_, value)  # type: ignore[misc]

    async def hdel(self, key: str, *fields: str) -> None:
        if fields:
            await self._client.hdel(key, *fields)  # type: ignore[misc]

    async def hgetall(self, key: str) -> dict[str, str]:
        found: dict[str, str] = await self._client.hgetall(key)  # type: ignore[misc]
        return found

    async def hincr(self, key: str, field_: str, by: int) -> int:
        return int(await self._client.hincrby(key, field_, by))  # type: ignore[misc]

    async def incr(self, key: str, ttl_ms: int) -> int:
        async with self._client.pipeline(transaction=True) as pipe:
            pipe.incr(key)
            pipe.pexpire(key, ttl_ms, nx=True)
            value, _ = await pipe.execute()
        return int(value)

    async def mget(self, keys: list[str]) -> list[str | None]:
        if not keys:
            return []
        return list(await self._client.mget(keys))

    async def get(self, key: str) -> str | None:
        value = await self._client.get(key)
        return None if value is None else str(value)

    async def put(self, key: str, value: str, ttl_ms: int) -> None:
        await self._client.set(key, value, px=ttl_ms)

    async def delete(self, *keys: str) -> None:
        if keys:
            await self._client.delete(*keys)

    async def close(self) -> None:
        await self._client.aclose()
