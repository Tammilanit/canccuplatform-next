"""The feeds' handlers (docs/plans/issue-122.md, link 1): the router hands each event of a bound,
live event here, a feed only under its flag (router.py), and the trackers keep the live state in
Valkey. GUILD_CREATE's snapshot replaces each part whose flag is on and drops each part whose flag
is off, so a reconnect that could not resume leaves nothing stale.

`snapshot` builds one minute's counts from the live state minus bots and minus the people who hid
(privacy.py), at the moment it is built (D3)."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from canccu_kit import require_tenant
from canccu_kit.access import TenantContext

from . import live
from .activities import count_activities
from .channels import ChannelCache
from .live import LiveStore
from .messages import MessageCounter
from .presence import MembersTracker, PresenceTracker, count_statuses
from .voice import VoiceTracker

Hidden = Callable[[str], Awaitable[frozenset[str]]]

FEED_FLAGS = ("bot.presence", "bot.members", "bot.voice", "bot.messages")
PART_FLAGS = {"presence": "bot.presence", "voice": "bot.voice"}


@dataclass(frozen=True)
class Snapshot:
    """One minute's counts; a count is None when its feed is off."""

    members: int
    online: int | None
    idle: int | None
    dnd: int | None
    activities: list[dict[str, Any]] | None
    in_voice: int | None
    rooms: list[dict[str, Any]] | None


class Feeds:
    def __init__(
        self,
        store: LiveStore,
        context: Callable[[str], Awaitable[TenantContext | None]],
        hidden: Hidden,
    ) -> None:
        self._store = store
        self._context = context
        self._hidden = hidden
        self.clock: Callable[[], float] = time.time
        """When a message arrived, for its minute's counter."""
        self.served: dict[str, str] = {}
        """Events whose guild this client got a snapshot of: tenant → guild id. The counting job
        counts these (counting.py)."""

    def handlers(self) -> dict[str, Callable[[str, dict[str, Any]], Awaitable[None]]]:
        return {
            "guild": self.guild,
            **{flag: self.feed for flag in FEED_FLAGS},
        }

    async def guild(self, event: str, data: dict[str, Any]) -> None:
        tenant = require_tenant()
        channels = ChannelCache(self._store, tenant)
        if event == "GUILD_CREATE":
            await self._snapshot_in(tenant, data)
        elif event in ("CHANNEL_DELETE", "THREAD_DELETE"):
            await channels.remove(str(data.get("id")))
        elif event == "GUILD_ROLE_UPDATE":
            role = data.get("role")
            if isinstance(role, dict):
                await channels.role_changed(str(data.get("guild_id")), role)
        else:
            await channels.upsert(data)

    async def _snapshot_in(self, tenant: str, guild: dict[str, Any]) -> None:
        ctx = await self._context(tenant)
        flags = {} if ctx is None else ctx["flags"]
        await ChannelCache(self._store, tenant).load(guild)
        members_on = bool(flags.get("bot.members"))
        await MembersTracker(self._store, tenant).load(guild, with_members=members_on)
        if flags.get("bot.presence"):
            await PresenceTracker(self._store, tenant).load(guild.get("presences") or [])
        if flags.get("bot.voice"):
            await VoiceTracker(self._store, tenant).load(guild.get("voice_states") or [])
        await drop_off(self._store, tenant, flags)
        self.served[tenant] = str(guild.get("id"))

    async def feed(self, event: str, data: dict[str, Any]) -> None:
        tenant = require_tenant()
        if event == "PRESENCE_UPDATE":
            await PresenceTracker(self._store, tenant).update(data)
        elif event == "VOICE_STATE_UPDATE":
            await VoiceTracker(self._store, tenant).update(data)
        elif event == "GUILD_MEMBER_ADD":
            await MembersTracker(self._store, tenant).added(data)
        elif event == "GUILD_MEMBERS_CHUNK":
            await MembersTracker(self._store, tenant).chunk(data)
        elif event == "GUILD_MEMBER_REMOVE":
            user_id = await MembersTracker(self._store, tenant).removed(data)
            if user_id is not None:
                await PresenceTracker(self._store, tenant).forget(user_id)
                await VoiceTracker(self._store, tenant).forget(user_id)
        elif event == "MESSAGE_CREATE":
            view = await ChannelCache(self._store, tenant).view()
            counter = MessageCounter(self._store, tenant, clock=self.clock)
            await counter.seen(data, view, await self._hidden(tenant))

    async def snapshot(self, tenant: str, flags: dict[str, bool]) -> Snapshot:
        hidden = await self._hidden(tenant)
        members = MembersTracker(self._store, tenant)
        bots = await members.bots()
        online = idle = dnd = None
        activities = None
        if flags.get("bot.presence"):
            found = await PresenceTracker(self._store, tenant).read(hidden, bots)
            statuses = count_statuses(found)
            online, idle, dnd = statuses.online, statuses.idle, statuses.dnd
            activities = count_activities(found)
        in_voice = rooms = None
        if flags.get("bot.voice"):
            view = await ChannelCache(self._store, tenant).view()
            rooms, in_voice = await VoiceTracker(self._store, tenant).count(view, hidden, bots)
        return Snapshot(await members.count(hidden), online, idle, dnd, activities, in_voice, rooms)

    def forget(self, tenant: str) -> None:
        self.served.pop(tenant, None)


async def drop_off(store: LiveStore, tenant: str, flags: dict[str, bool]) -> None:
    """The live parts of feeds switched off go at once: nothing of a feed nobody switched on."""
    off = tuple(part for part, flag in PART_FLAGS.items() if not flags.get(flag))
    if not flags.get("bot.members"):
        off += ("members", "bots")
    if off:
        await live.clear(store, tenant, off)
