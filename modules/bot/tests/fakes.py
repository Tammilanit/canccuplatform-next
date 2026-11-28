"""Test doubles: the fake Discord's gateway as the bot's transport, and Valkey's keys in memory."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from canccu_kit.testing import discord as fake_discord

from canccu_bot.gateway import Connector, GatewayClosed


class _Adapted:
    """The fake's in-memory connection, raising the bot's own GatewayClosed."""

    def __init__(self, inner: fake_discord.MemoryTransport) -> None:
        self.inner = inner

    async def send(self, payload: dict[str, Any]) -> None:
        try:
            await self.inner.send(payload)
        except fake_discord.GatewayClosed as exc:
            raise GatewayClosed(exc.code) from exc

    async def recv(self) -> dict[str, Any]:
        try:
            return await self.inner.recv()
        except fake_discord.GatewayClosed as exc:
            raise GatewayClosed(exc.code) from exc

    async def close(self, code: int = 1000) -> None:
        await self.inner.close(code)


def connector(fake: fake_discord.FakeDiscord, dialled: list[str] | None = None) -> Connector:
    async def connect(url: str) -> _Adapted:
        if dialled is not None:
            dialled.append(url)
        return _Adapted(await fake.gateway.connect(url))

    return connect


@dataclass
class MemoryKeys:
    """The lease and status keys with Valkey's semantics, on a clock the test moves."""

    now_ms: int = 0
    values: dict[str, tuple[str, int]] = field(default_factory=dict)

    def _live(self, key: str) -> str | None:
        found = self.values.get(key)
        if found is None or found[1] <= self.now_ms:
            self.values.pop(key, None)
            return None
        return found[0]

    async def acquire(self, key: str, holder: str, ttl_ms: int) -> bool:
        if self._live(key) is not None:
            return False
        self.values[key] = (holder, self.now_ms + ttl_ms)
        return True

    async def renew(self, key: str, holder: str, ttl_ms: int) -> bool:
        if self._live(key) != holder:
            return False
        self.values[key] = (holder, self.now_ms + ttl_ms)
        return True

    async def release(self, key: str, holder: str) -> None:
        if self._live(key) == holder:
            del self.values[key]

    async def put(self, key: str, value: str, ttl_ms: int) -> None:
        self.values[key] = (value, self.now_ms + ttl_ms)

    async def get(self, key: str) -> str | None:
        return self._live(key)

    async def take(self, key: str) -> str | None:
        value = self._live(key)
        self.values.pop(key, None)
        return value


@dataclass
class FakeAudit:
    entries: list[dict[str, Any]] = field(default_factory=list)

    async def append(
        self,
        tenant_id: str,
        actor_user_id: str | None,
        action: str,
        target: dict[str, str],
        changes: dict[str, object] | None = None,
        reason: str | None = None,
    ) -> None:
        self.entries.append(
            {
                "tenant_id": tenant_id,
                "actor_user_id": actor_user_id,
                "action": action,
                "target": target,
                "changes": changes or {},
                "reason": reason,
            }
        )


@dataclass
class FakeUsers:
    """The users seam: a user's Discord id, or None as while #150 does not serve it."""

    discord_ids: dict[str, str] = field(default_factory=dict)

    async def discord_id(self, user_id: str) -> str | None:
        return self.discord_ids.get(user_id)


@dataclass
class FakeSeries:
    """The series seam: the events whose admin the caller is, in this event's series."""

    admin_of: set[str] = field(default_factory=set)

    async def admin_of_both(self, host: str, cookie: str | None, source: str, target: str) -> bool:
        return {source, target} <= self.admin_of


@dataclass
class MemoryLive:
    """The live state's Valkey (live.LiveStore) in memory: hashes and counters, with expiry on a
    clock the test moves."""

    now_ms: int = 0
    values: dict[str, Any] = field(default_factory=dict)
    expires: dict[str, int] = field(default_factory=dict)

    def _gone(self, key: str) -> None:
        at = self.expires.get(key)
        if at is not None and at <= self.now_ms:
            self.values.pop(key, None)
            self.expires.pop(key, None)

    def _hash(self, key: str) -> dict[str, str]:
        self._gone(key)
        found: dict[str, str] = self.values.setdefault(key, {})
        return found

    async def replace(self, key: str, mapping: dict[str, str]) -> None:
        self.values.pop(key, None)
        if mapping:
            self.values[key] = dict(mapping)

    async def hset(self, key: str, field_: str, value: str) -> None:
        self._hash(key)[field_] = value

    async def hdel(self, key: str, *fields: str) -> None:
        found = self._hash(key)
        for f in fields:
            found.pop(f, None)
        if not found:
            self.values.pop(key, None)

    async def hgetall(self, key: str) -> dict[str, str]:
        self._gone(key)
        return dict(self.values.get(key) or {})

    async def hincr(self, key: str, field_: str, by: int) -> int:
        found = self._hash(key)
        found[field_] = str(int(found.get(field_, "0")) + by)
        return int(found[field_])

    async def incr(self, key: str, ttl_ms: int) -> int:
        self._gone(key)
        value = int(self.values.get(key, "0")) + 1
        self.values[key] = str(value)
        self.expires.setdefault(key, self.now_ms + ttl_ms)
        return value

    async def mget(self, keys: list[str]) -> list[str | None]:
        out: list[str | None] = []
        for key in keys:
            self._gone(key)
            value = self.values.get(key)
            out.append(value if isinstance(value, str) else None)
        return out

    async def get(self, key: str) -> str | None:
        return (await self.mget([key]))[0]

    async def put(self, key: str, value: str, ttl_ms: int) -> None:
        self.values[key] = value
        self.expires[key] = self.now_ms + ttl_ms

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self.values.pop(key, None)
            self.expires.pop(key, None)
