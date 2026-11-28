"""The feeds' handler for one client (contracts/bot.md, Counts): the router hands it each event's
gateway data that passed the guild route and the feed flags; it keeps the live state per event,
counts messages, writes the state behind to Valkey every few seconds and counts each minute.

It runs in the container that holds the client's lease, so each event's minute is counted by one
container; after a handover the next holder reads the state back from Valkey and the gateway's
snapshot. Every count leaves out `hidden_discord_ids` (privacy.py) when it is built (D3)."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from canccu_kit import require_tenant

from . import counts
from .deps import Deps
from .live import GuildLive
from .message_tracker import counts as message_counts
from .router import Directory

log = logging.getLogger("canccu_bot.feeds")

FLUSH_S = 5.0
CLEARED_WHEN_OFF = ("bot.presence", "bot.voice", "bot.members")


class Feeds:
    def __init__(self, d: Deps, application_id: str, directory: Directory) -> None:
        self._d = d
        self._app = application_id
        self.directory = directory
        self._lives: dict[str, GuildLive] = {}
        self._loading = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None

    async def _live(self, tenant: str) -> GuildLive:
        live = self._lives.get(tenant)
        if live is None:
            async with self._loading:
                live = self._lives.get(tenant)
                if live is None:
                    live = GuildLive(tenant)
                    await live.load(self._d.keys)
                    self._lives[tenant] = live
        return live

    async def on(self, event: str, data: dict[str, Any]) -> None:
        """A router handler: runs inside the event's tenant."""
        tenant = require_tenant()
        live = await self._live(tenant)
        if event != "MESSAGE_CREATE":
            live.apply(event, data)
        elif message_counts(data, live.channels, await self._d.hidden(tenant)):
            await counts.count_message(self._d, tenant)

    async def flush(self) -> None:
        for live in list(self._lives.values()):
            try:
                await live.flush(self._d.keys)
            except Exception:
                log.exception("writing the live state of %s failed", live.tenant)

    async def tick(self) -> None:
        """Count the minute that ended for every event this client serves."""
        now = self._d.now()
        for tenant, live in list(self._lives.items()):
            try:
                await self._tick(tenant, live, now)
            except Exception:
                log.exception("counting the minute of %s failed", tenant)

    async def _tick(self, tenant: str, live: GuildLive, now: Any) -> None:
        ctx = await self.directory.context(tenant)
        guild = live.guild_id
        route = None if guild is None else await self.directory.route(guild)
        if ctx is None or ctx["status"] == "archived" or route != (tenant, self._app):
            # Archived, unbound or moved to another application: its live state goes; its
            # counts stay with the event (contracts/bot.md, Counts).
            await live.drop(self._d.keys)
            self._lives.pop(tenant, None)
            return
        flags = ctx["flags"]
        for flag in CLEARED_WHEN_OFF:
            if not flags.get(flag, False):
                live.clear(flag)
        await counts.record(
            self._d, tenant, live.snapshot(await self._d.hidden(tenant)), flags, now
        )
        await live.flush(self._d.keys)
        await counts.fold(self._d, tenant, now)

    async def run(self, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> None:
        counted = None
        while True:
            await sleep(FLUSH_S)
            await self.flush()
            minute = counts.floor_minute(self._d.now())
            if minute != counted:
                counted = minute
                await self.tick()

    def start(self) -> None:
        self._task = asyncio.create_task(self.run())

    async def close(self) -> None:
        """The client stopped: what was not yet written behind goes now."""
        if self._task is not None:
            self._task.cancel()
            self._task = None
        await self.flush()
