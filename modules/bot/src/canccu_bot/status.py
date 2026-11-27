"""Each client's status where every container reads it, and `bot.client.changed` for the events
a client serves: at most once a minute per event, the last status winning (contracts/bot.md)."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from canccu_kit import Bus

from .lease import KeyStore, status_key

STATUS_TTL_MS = 60_000
"""The holder writes a client's status on each change and each lease renewal (every 10 s); one
nobody refreshes, after its container died, runs out and reads as unknown."""


class StatusBoard:
    def __init__(self, keys: KeyStore) -> None:
        self._keys = keys

    async def publish(
        self, application_id: str, status: dict[str, Any], bot_user: dict[str, str] | None
    ) -> None:
        value = json.dumps({**status, "bot_user": bot_user})
        await self._keys.put(status_key(application_id), value, STATUS_TTL_MS)

    async def read(self, application_id: str) -> dict[str, Any] | None:
        """The status with `bot_user`, or None when no container reports the client."""
        value = await self._keys.get(status_key(application_id))
        return None if value is None else dict(json.loads(value))


@dataclass
class _Held:
    last_sent: float
    pending: dict[str, Any] | None = None
    timer: asyncio.Task[None] | None = None


class ClientEvents:
    def __init__(
        self,
        bus: Bus,
        tenants_of: Callable[[str], Awaitable[list[str]]],
        *,
        interval_s: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._bus = bus
        self._tenants_of = tenants_of
        self._interval = interval_s
        self._clock = clock
        self._held: dict[str, _Held] = {}

    async def changed(self, application_id: str, status: dict[str, Any]) -> None:
        data = {k: status[k] for k in ("status", "error_code", "since")}
        for tenant in await self._tenants_of(application_id):
            await self._one(tenant, data)

    async def _one(self, tenant: str, data: dict[str, Any]) -> None:
        held = self._held.get(tenant)
        now = self._clock()
        if held is None or now - held.last_sent >= self._interval:
            self._held[tenant] = _Held(last_sent=now)
            await self._send(tenant, data)
            return
        held.pending = data
        if held.timer is None:
            wait = self._interval - (now - held.last_sent)
            held.timer = asyncio.create_task(self._later(tenant, held, wait))

    async def _later(self, tenant: str, held: _Held, wait: float) -> None:
        await asyncio.sleep(wait)
        held.timer = None
        if held.pending is not None:
            data, held.pending = held.pending, None
            held.last_sent = self._clock()
            await self._send(tenant, data)

    async def _send(self, tenant: str, data: dict[str, Any]) -> None:
        await self._bus.publish("bot.client.changed", data, version=1, tenant=tenant)

    async def close(self) -> None:
        timers = [h.timer for h in self._held.values() if h.timer is not None]
        for timer in timers:
            timer.cancel()
        await asyncio.gather(*timers, return_exceptions=True)
