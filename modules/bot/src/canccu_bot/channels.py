"""The guild's channels, as the counts need them (docs/plans/issue-122.md, D4): messages are counted
only in channels everyone in the server can read (D6 B), and a voice room is shown only when
everyone can see it (contracts/bot.md, Who plays what). "Everyone" is the @everyone role: its
server permissions, then its overwrite in the channel, as Discord computes them (perms.py).

Kept in Valkey with the live state (from GUILD_CREATE and the channel, thread and role events), so
every container and a restarted one read the same view. A channel name is no personal data."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from . import perms
from .live import LiveStore, live_key

VOICE_KINDS = (2, 13)
"""Voice and stage channels."""
PUBLIC_THREADS = (10, 11)
"""Announcement and public threads: as readable as their parent. A private thread (12) never is."""
EVERYONE = "everyone"
"""The field of the channels hash holding @everyone's server permissions."""


def _record(channel: dict[str, Any], guild_id: str) -> str:
    everyone = next(
        (
            {"allow": o.get("allow"), "deny": o.get("deny"), "id": guild_id, "type": 0}
            for o in channel.get("permission_overwrites") or []
            if isinstance(o, dict) and str(o.get("id")) == guild_id
        ),
        None,
    )
    parent = channel.get("parent_id")
    record = {
        "t": channel.get("type"),
        "n": channel.get("name"),
        "p": None if parent is None else str(parent),
        "o": everyone,
    }
    return json.dumps(record, separators=(",", ":"))


@dataclass(frozen=True)
class Channels:
    guild_id: str
    everyone: int
    records: dict[str, dict[str, Any]]

    def _viewable(self, record: dict[str, Any]) -> bool:
        roles = {self.guild_id: {"permissions": self.everyone}}
        overwrites = [record["o"]] if record.get("o") else []
        bits = perms.in_channel(self.guild_id, roles, [], "", overwrites)
        return bool(bits & perms.VIEW_CHANNEL)

    def public(self, channel_id: str) -> bool:
        record = self.records.get(channel_id)
        if record is None:
            return False
        if record.get("t") in PUBLIC_THREADS:
            parent = self.records.get(str(record.get("p")))
            return (
                parent is not None
                and parent.get("t") not in PUBLIC_THREADS
                and (self._viewable(parent))
            )
        if record.get("t") == 12:
            return False
        return self._viewable(record)

    def voice_rooms(self) -> dict[str, str]:
        """Public voice rooms: id → name."""
        return {
            cid: str(r.get("n") or "")
            for cid, r in self.records.items()
            if r.get("t") in VOICE_KINDS and self.public(cid)
        }


class ChannelCache:
    def __init__(self, store: LiveStore, tenant: str) -> None:
        self._store = store
        self._key = live_key(tenant, "channels")
        self._guild_key = live_key(tenant, "guild")

    async def load(self, guild: dict[str, Any]) -> None:
        guild_id = str(guild.get("id"))
        mapping = {}
        for channel in [*(guild.get("channels") or []), *(guild.get("threads") or [])]:
            if isinstance(channel, dict) and channel.get("id") is not None:
                mapping[str(channel["id"])] = _record(channel, guild_id)
        everyone: dict[str, Any] = next(
            (r for r in guild.get("roles") or [] if str(r.get("id")) == guild_id), {}
        )
        mapping[EVERYONE] = str(everyone.get("permissions") or "0")
        await self._store.replace(self._key, mapping)
        await self._store.hset(self._guild_key, "guild_id", guild_id)

    async def _guild_id(self) -> str:
        return (await self._store.hgetall(self._guild_key)).get("guild_id", "")

    async def upsert(self, channel: dict[str, Any]) -> None:
        """CHANNEL_CREATE or _UPDATE, THREAD_CREATE or _UPDATE."""
        if channel.get("id") is None:
            return
        guild_id = str(channel.get("guild_id") or await self._guild_id())
        await self._store.hset(self._key, str(channel["id"]), _record(channel, guild_id))

    async def remove(self, channel_id: str) -> None:
        await self._store.hdel(self._key, channel_id)

    async def role_changed(self, guild_id: str, role: dict[str, Any]) -> None:
        """GUILD_ROLE_UPDATE: only @everyone's (its id is the guild's) changes who can read."""
        if str(role.get("id")) == guild_id:
            await self._store.hset(self._key, EVERYONE, str(role.get("permissions") or "0"))

    async def view(self) -> Channels:
        raw = await self._store.hgetall(self._key)
        everyone = int(raw.pop(EVERYONE, "0") or 0)
        records = {}
        for cid, value in raw.items():
            try:
                records[cid] = json.loads(value)
            except ValueError:
                continue
        return Channels(await self._guild_id(), everyone, records)
