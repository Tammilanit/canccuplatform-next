"""Presence and members (port of the legacy `presence_tracker`, with changes: step 6 plan, D7).

The legacy tracker walked discord.py's member cache every interval and wrote a snapshot per
status. Here the gateway's updates keep a live hash per event in Valkey (live.py) and a count is
built from it on demand: online, idle and do not disturb (offline is not counted), bots skipped as
before, and now also the people who hid (privacy.py), left out at the moment the count is built
(E7). An entry holds the status and the "playing" activities, never a name."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .live import LiveStore, live_key

STATUSES = ("online", "idle", "dnd")
PLAYING = 0
"""Discord's activity type for "Playing"; streaming, listening and custom statuses are no game."""


@dataclass(frozen=True)
class PresenceCount:
    online: int
    idle: int
    dnd: int


def _user_id(data: dict[str, Any]) -> str | None:
    user = data.get("user")
    found = user.get("id") if isinstance(user, dict) else None
    return str(found) if found is not None else None


def _playing(activities: Any) -> list[list[str | None]]:
    """[application id or None, name] of each "playing" activity."""
    out: list[list[str | None]] = []
    for activity in activities if isinstance(activities, list) else []:
        if not isinstance(activity, dict) or activity.get("type") != PLAYING:
            continue
        name = activity.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        app = activity.get("application_id")
        out.append([None if app is None else str(app), name])
    return out


def entry(data: dict[str, Any]) -> str | None:
    """A presence as the live state keeps it, or None for someone offline doing nothing."""
    status = data.get("status")
    status = status if status in STATUSES else "offline"
    playing = _playing(data.get("activities"))
    if status == "offline" and not playing:
        return None
    return json.dumps({"s": status, "a": playing}, separators=(",", ":"))


def entries(raw: dict[str, str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for user_id, value in raw.items():
        try:
            parsed = json.loads(value)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            out[user_id] = parsed
    return out


class PresenceTracker:
    def __init__(self, store: LiveStore, tenant: str) -> None:
        self._store = store
        self._key = live_key(tenant, "presence")

    async def load(self, presences: list[dict[str, Any]]) -> None:
        """GUILD_CREATE's presences: the whole state, replacing what was kept."""
        mapping: dict[str, str] = {}
        for data in presences:
            user_id, value = _user_id(data), entry(data)
            if user_id is not None and value is not None:
                mapping[user_id] = value
        await self._store.replace(self._key, mapping)

    async def update(self, data: dict[str, Any]) -> None:
        user_id = _user_id(data)
        if user_id is None:
            return
        value = entry(data)
        if value is None:
            await self._store.hdel(self._key, user_id)
        else:
            await self._store.hset(self._key, user_id, value)

    async def forget(self, user_id: str) -> None:
        """Someone left the guild."""
        await self._store.hdel(self._key, user_id)

    async def read(self, hidden: frozenset[str], bots: frozenset[str]) -> dict[str, dict[str, Any]]:
        """The live entries, without bots and the people who hid."""
        found = entries(await self._store.hgetall(self._key))
        return {u: e for u, e in found.items() if u not in hidden and u not in bots}

    async def count(self, hidden: frozenset[str], bots: frozenset[str]) -> PresenceCount:
        return count_statuses(await self.read(hidden, bots))


def count_statuses(found: dict[str, dict[str, Any]]) -> PresenceCount:
    statuses = [e.get("s") for e in found.values()]
    return PresenceCount(*(statuses.count(s) for s in STATUSES))


class MembersTracker:
    """The guild's member count, as Discord counts it (`member_count`, bots included), kept up to
    date by joins and leaves. While the `bot.members` feed is on, the member list tells bots apart
    and who is in the guild, so bots and the people who hid come off the count."""

    def __init__(self, store: LiveStore, tenant: str) -> None:
        self._store = store
        self._guild = live_key(tenant, "guild")
        self._members = live_key(tenant, "members")
        self._bots = live_key(tenant, "bots")

    async def load(self, guild: dict[str, Any], *, with_members: bool) -> None:
        count = guild.get("member_count")
        # A field, not the whole hash: the channel cache keeps the guild id beside it.
        await self._store.hset(
            self._guild, "member_count", str(count if isinstance(count, int) else 0)
        )
        people: dict[str, str] = {}
        bots: dict[str, str] = {}
        if with_members:
            for data in guild.get("members") or []:
                user_id = _user_id(data) if isinstance(data, dict) else None
                if user_id is not None:
                    (bots if data["user"].get("bot") else people)[user_id] = "1"
        await self._store.replace(self._members, people)
        await self._store.replace(self._bots, bots)

    async def chunk(self, data: dict[str, Any]) -> None:
        """GUILD_MEMBERS_CHUNK: more of the member list, for a large guild."""
        for found in data.get("members") or []:
            if isinstance(found, dict):
                await self._know(found)

    async def _know(self, data: dict[str, Any]) -> str | None:
        user_id = _user_id(data)
        if user_id is not None:
            key = self._bots if data["user"].get("bot") else self._members
            await self._store.hset(key, user_id, "1")
        return user_id

    async def added(self, data: dict[str, Any]) -> None:
        if await self._know(data) is not None:
            await self._store.hincr(self._guild, "member_count", 1)

    async def removed(self, data: dict[str, Any]) -> str | None:
        user_id = _user_id(data)
        if user_id is None:
            return None
        await self._store.hdel(self._members, user_id)
        await self._store.hdel(self._bots, user_id)
        await self._store.hincr(self._guild, "member_count", -1)
        return user_id

    async def bots(self) -> frozenset[str]:
        return frozenset(await self._store.hgetall(self._bots))

    async def count(self, hidden: frozenset[str]) -> int:
        guild = await self._store.hgetall(self._guild)
        total = int(guild.get("member_count", "0"))
        known = await self._store.hgetall(self._members)
        hid = sum(1 for user_id in hidden if user_id in known)
        return max(0, total - len(await self.bots()) - hid)
