"""The client pool (contracts/bot.md, The client pool): the shared client and each event's own
client, each held by one container at a time through a lease in Valkey.

Every tick (10 s) the pool reads which applications should run, renews the leases it holds,
takes free ones, and closes what it lost or no longer wants. A container that dies stops
renewing, and after 30 s another one takes its clients over. So an own client opens and closes
within a tick of its connection changing, without a restart.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from .lease import KeyStore, lease_key
from .status import StatusBoard

log = logging.getLogger("canccu_bot.pool")

LEASE_TTL_MS = 30_000
RENEW_S = 10.0


class Client(Protocol):
    application_id: str

    @property
    def status(self) -> dict[str, Any]: ...

    @property
    def bot_user(self) -> dict[str, str] | None: ...

    async def start(self) -> None: ...

    async def stop(self) -> None: ...


class Pool:
    def __init__(
        self,
        *,
        holder: str,
        keys: KeyStore,
        board: StatusBoard,
        wanted: Callable[[], Awaitable[dict[str, str]]],
        open_client: Callable[[str, str], Awaitable[Client]],
    ) -> None:
        self._holder = holder
        self._keys = keys
        self._board = board
        self._wanted = wanted
        self._open_client = open_client
        self._clients: dict[str, tuple[str, Client]] = {}
        self._stopped = asyncio.Event()
        self._confirmed: dict[str, float] = {}  # when each held lease was last renewed

    def held(self) -> list[str]:
        return list(self._clients)

    def client(self, application_id: str) -> Client | None:
        found = self._clients.get(application_id)
        return None if found is None else found[1]

    async def _renew_held(self) -> None:
        """Renewal comes first and never waits on Postgres: a database outage must not let a
        lease lapse under a running client, or another container would open the same token."""
        for app_id in list(self._clients):
            try:
                renewed = await self._keys.renew(lease_key(app_id), self._holder, LEASE_TTL_MS)
            except Exception:
                log.exception("could not renew the lease of application %s", app_id)
                age = time.monotonic() - self._confirmed.get(app_id, 0.0)
                if age >= LEASE_TTL_MS / 1000:  # it may have expired: stop before another opens it
                    await self._close(app_id, release=False)
                continue
            if renewed:
                self._confirmed[app_id] = time.monotonic()
            else:
                log.warning("lost the lease of application %s; closing its client", app_id)
                await self._close(app_id, release=False)

    async def tick(self) -> None:
        await self._renew_held()
        wanted = await self._wanted()
        for app_id, (token, _) in list(self._clients.items()):
            if wanted.get(app_id) != token:  # gone, or a rotated token opens a new client
                await self._close(app_id, release=True)
        for app_id, token in wanted.items():
            if app_id not in self._clients:
                await self._take(app_id, token)
        for _, client in self._clients.values():
            await self._board.publish(client.application_id, client.status, client.bot_user)

    async def _take(self, app_id: str, token: str) -> None:
        if not await self._keys.acquire(lease_key(app_id), self._holder, LEASE_TTL_MS):
            return  # another container holds it
        try:
            client = await self._open_client(app_id, token)
            await client.start()
        except Exception:
            log.exception("could not open the client of application %s", app_id)
            await self._keys.release(lease_key(app_id), self._holder)
            return
        self._clients[app_id] = (token, client)
        self._confirmed[app_id] = time.monotonic()

    async def _close(self, app_id: str, *, release: bool) -> None:
        _, client = self._clients.pop(app_id)
        self._confirmed.pop(app_id, None)
        try:
            await client.stop()
        except Exception:
            log.exception("closing the client of application %s failed", app_id)
        if release:
            await self._keys.release(lease_key(app_id), self._holder)

    async def run(self) -> None:
        while not self._stopped.is_set():
            try:
                await self.tick()
            except Exception:
                log.exception("pool tick failed")  # Valkey or Postgres away: try again
            try:
                await asyncio.wait_for(self._stopped.wait(), RENEW_S)
            except TimeoutError:
                pass

    async def close(self) -> None:
        self._stopped.set()
        for app_id in list(self._clients):
            await self._close(app_id, release=True)
