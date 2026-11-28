"""The live state of one event's guild (D2 of docs/plans/issue-122.md): the trackers' state in
memory, written behind to Valkey hashes `bot:live:<tenant>:<slice>` and read back after a
restart, so a restart loses none of it before the gateway's snapshot comes again. Discord ids
only, never a name (D7); never on Postgres. It goes at archiving, at an unbind and when its
feed's flag goes off (contracts/bot.md, Counts)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .activity_tracker import ActivityTracker
from .channels import PublicChannels
from .lease import KeyStore
from .presence_tracker import PresenceTracker, user_id
from .router import GUILD_EVENTS
from .tracked import Tracked
from .voice_tracker import VoiceTracker

LIVE_TTL_MS = 24 * 3600 * 1000
"""A safety net only: every flush gives the hashes this long again, so the state of a client
that stopped for good (its guild unbound while no container held it) runs out by itself."""

SLICES = ("members", "bots", "presence", "guild", "playing", "voice", "channels")
AS_OF = "as_of"
"""When the holder last wrote the state behind: the module paths' `as_of` (presence_paths.py)."""


def live_key(tenant: str, name: str) -> str:
    return f"bot:live:{tenant}:{name}"


def live_keys(tenant: str) -> list[str]:
    return [live_key(tenant, name) for name in (*SLICES, AS_OF)]


class GuildLive:
    def __init__(self, tenant: str) -> None:
        self.tenant = tenant
        self.presence = PresenceTracker()
        self.activities = ActivityTracker()
        self.voice = VoiceTracker()
        self.channels = PublicChannels()

    @property
    def guild_id(self) -> str | None:
        return self.channels.guild_id

    def _slices(self) -> dict[str, Tracked]:
        out: dict[str, Tracked] = {}
        for tracker in (self.presence, self.activities, self.voice, self.channels):
            out.update(tracker.slices())
        return out

    def apply(self, event: str, data: dict[str, Any]) -> None:
        # The bots the router kept from parts and feeds it dropped (router.py, `bots`).
        self.presence.seen_bots(data.get("bots") or [])
        if event == "GUILD_CREATE":
            self.channels.guild(data)
            self.presence.guild(data)
            self.activities.guild(data)
            self.voice.guild(data)
        elif event == "GUILD_MEMBERS_CHUNK":
            # The answer to a members request (op 8): its presences hold only who is not offline.
            self.presence.member(event, data)
            for p in data.get("presences") or []:
                self.presence.presence(p)
                self.activities.presence(p)
        elif event == "PRESENCE_UPDATE":
            self.presence.presence(data)
            self.activities.presence(data)
        elif event.startswith("GUILD_MEMBER"):
            self.presence.member(event, data)
            uid = user_id(data)
            if event == "GUILD_MEMBER_REMOVE" and uid is not None:
                self.activities.playing.drop(uid)
                self.voice.states.drop(uid)
        elif event == "VOICE_STATE_UPDATE":
            self.voice.update(data)
        elif event in GUILD_EVENTS:
            self.channels.update(event, data)

    def clear(self, flag: str) -> None:
        """A feed's flag went off: what it brought goes, as if it had never come."""
        if flag == "bot.presence":
            self.presence.statuses.clear()
            self.activities.playing.clear()
        elif flag == "bot.voice":
            self.voice.states.clear()
        elif flag == "bot.members":
            self.presence.members.clear()

    def snapshot(self, hidden: frozenset[str]) -> dict[str, Any]:
        """The counts now, without bots and without the people who hid."""
        bots = self.presence.bots()
        in_voice, rooms = self.voice.count(hidden, bots, self.channels.voice_rooms())
        return {
            **self.presence.count(hidden),
            "in_voice": in_voice,
            "rooms": rooms,
            "activities": self.activities.count(hidden, bots),
        }

    async def flush(self, keys: KeyStore, at: datetime | None = None) -> None:
        for name, tracked in self._slices().items():
            values, gone = tracked.changes()
            await keys.hash_write(live_key(self.tenant, name), values, gone, LIVE_TTL_MS)
            tracked.written(values, gone)
        if at is not None:
            await keys.put(live_key(self.tenant, AS_OF), at.isoformat(), LIVE_TTL_MS)

    async def load(self, keys: KeyStore) -> None:
        for name, tracked in self._slices().items():
            tracked.load(await keys.hash_read(live_key(self.tenant, name)))

    async def drop(self, keys: KeyStore) -> None:
        await keys.delete(*live_keys(self.tenant))
        for tracked in self._slices().values():
            tracked.load({})
