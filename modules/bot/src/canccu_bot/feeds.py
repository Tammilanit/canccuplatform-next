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
from datetime import datetime
from typing import Any

from canccu_kit import require_tenant
from canccu_kit.access import TenantContext

from . import counts
from .deps import Deps
from .live import GuildLive, live_keys
from .message_tracker import counts as message_counts
from .rest import RestError
from .router import SNAPSHOT_PARTS, Directory

log = logging.getLogger("canccu_bot.feeds")

FLUSH_S = 5.0
CLEARED_WHEN_OFF = ("bot.presence", "bot.voice", "bot.members")
ASKED_WITH_MEMBERS = ("bot.members", "bot.presence")
"""The feeds a members request (op 8) brings whole: the members and their presences."""


class Feeds:
    def __init__(self, d: Deps, application_id: str, directory: Directory) -> None:
        self._d = d
        self._app = application_id
        self.directory = directory
        self._lives: dict[str, GuildLive] = {}
        self._fed: dict[str, frozenset[str]] = {}
        """Per event, which of ASKED_WITH_MEMBERS its live state has had whole (a snapshot or a
        members request) since the flag came on."""
        self._loading = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self.rest: Any = None
        """The client's RestClient, set once the client exists."""
        self.request_members: Callable[[str], Awaitable[bool]] | None = None
        """The client's op 8 on the guild's shard; False when it could not ask."""
        self.in_guild: Callable[[str], bool] = lambda guild: False
        """Whether the client is in the guild (its router's `guilds`); set once the client
        exists."""

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
        if event == "GUILD_CREATE":
            whole = (SNAPSHOT_PARTS[part] for part in ("members", "presences") if part in data)
            self._fed[tenant] = frozenset(whole)
            live.apply(event, data)
            if data.get("large"):
                # A large guild's snapshot names only who is online: the rest, the offline bots
                # among them, come in members chunks.
                await self._ask_members(str(data.get("id")))
        elif event != "MESSAGE_CREATE":
            live.apply(event, data)
        elif message_counts(data, live.channels, await self._d.hidden(tenant)):
            await counts.count_message(self._d, tenant)

    async def _ask_members(self, guild: str) -> bool:
        return self.request_members is not None and await self.request_members(guild)

    async def _serves(
        self, tenant: str, routes: dict[str, str]
    ) -> tuple[str, TenantContext] | None:
        """(its guild, its context) while this client serves the event, read fresh: its guild
        is routed to this application and the event is there and not archived."""
        guild = routes.get(tenant)
        if guild is None:
            return None
        ctx = await self.directory.context(tenant, fresh=True)
        return None if ctx is None or ctx["status"] == "archived" else (guild, ctx)

    async def _forget(self, tenant: str) -> None:
        """Archived, deleted, unbound or moved to another application: its live state goes and
        is never written again; its counts stay with the event (contracts/bot.md, Counts)."""
        self._fed.pop(tenant, None)
        self._lives.pop(tenant, None)
        await self._d.keys.delete(*live_keys(tenant))

    async def flush(self) -> None:
        """Each event's live state written behind, or dropped when the client no longer serves
        the event: checked fresh, so a deleted or unbound event's state is never written back
        after its keys went."""
        try:
            routes = await self.directory.guilds_of(self._app)
        except Exception:
            log.exception("reading the guild routes of application %s failed", self._app)
            return
        for tenant, live in list(self._lives.items()):
            try:
                served = await self._serves(tenant, routes)
                if served is None or live.guild_id not in (None, served[0]):
                    await self._forget(tenant)
                else:
                    await live.flush(self._d.keys, self._d.now())
            except Exception:
                log.exception("writing the live state of %s failed", tenant)

    async def tick(self) -> None:
        """Count the minute that ended for every event this client serves."""
        now = self._d.now()
        try:
            routes = await self.directory.guilds_of(self._app)
        except Exception:
            log.exception("reading the guild routes of application %s failed", self._app)
            return
        for tenant in {*routes, *self._lives}:
            try:
                await self._tick(tenant, routes, now)
            except Exception:
                log.exception("counting the minute of %s failed", tenant)

    async def _tick(self, tenant: str, routes: dict[str, str], now: datetime) -> None:
        served = await self._serves(tenant, routes)
        live = None if served is None else await self._live(tenant)
        if served is None or live is None or live.guild_id not in (None, served[0]):
            await self._forget(tenant)
            return
        guild, ctx = served
        flags = ctx["flags"]
        await self._seed(tenant, guild, live, flags)
        if live.guild_id is None:
            return  # nothing is known of the guild yet: no minute of zeros
        for flag in CLEARED_WHEN_OFF:
            if not flags.get(flag, False):
                live.clear(flag)
        await counts.record(
            self._d, tenant, live.snapshot(await self._d.hidden(tenant)), flags, now
        )
        await live.flush(self._d.keys, self._d.now())
        await counts.fold(self._d, tenant, now)

    async def _seed(self, tenant: str, guild: str, live: GuildLive, flags: dict[str, bool]) -> None:
        """What the snapshot would have brought, for a guild bound after its snapshot came (a
        bind always is: bind.py needs the bot in the guild first) or a feed switched on since:
        the channels and roles over REST, the members and their presences through op 8 where
        the members intent is on."""
        wanted = frozenset(f for f in ASKED_WITH_MEMBERS if flags.get(f, False))
        # A state read back from Valkey was fed before the restart; the snapshot comes again.
        fed = self._fed.setdefault(tenant, wanted if live.guild_id is not None else frozenset())
        if live.guild_id is None:
            if not self.in_guild(guild):
                return  # its snapshot is still to come, or the bot is not in it
            path = f"/guilds/{guild}"
            try:
                channels = await self.rest.request("GET", f"{path}/channels", tenant=tenant)
                roles = await self.rest.request("GET", f"{path}/roles", tenant=tenant)
            except RestError:
                log.warning("reading guild %s for %s failed", guild, tenant, exc_info=True)
                return
            live.apply("GUILD_CREATE", {"id": guild, "channels": channels, "roles": roles})
        if wanted - fed and await self._ask_members(guild):
            fed = wanted
        # A flag that goes off is asked for again when it comes back on.
        self._fed[tenant] = fed & wanted

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
        """The client stopped: what was not yet written behind goes now, but never the live state
        of an event it no longer serves (an unbind or a deletion closes an own client before a
        minute has seen it)."""
        if self._task is not None:
            self._task.cancel()
            self._task = None
        await self.flush()
