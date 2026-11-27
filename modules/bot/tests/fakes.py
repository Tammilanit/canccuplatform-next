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
