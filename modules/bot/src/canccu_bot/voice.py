"""Voice (port of the legacy `voice_tracker`, with changes: step 6 plan, D7, D8).

The legacy tracker walked each voice channel every interval and wrote one snapshot row per room
with its user count. Here VOICE_STATE_UPDATE keeps a live hash per event (Discord id → channel id,
live.py), and the count is built from it: everyone in voice, bots skipped as before and the people
who hid left out (E7), and the public rooms with people in them, by name and count, never who."""

from __future__ import annotations

from collections import Counter
from typing import Any

from .channels import Channels
from .live import LiveStore, live_key


class VoiceTracker:
    def __init__(self, store: LiveStore, tenant: str) -> None:
        self._store = store
        self._key = live_key(tenant, "voice")

    async def load(self, states: list[dict[str, Any]]) -> None:
        """GUILD_CREATE's voice states: the whole state, replacing what was kept."""
        mapping = {
            str(s["user_id"]): str(s["channel_id"])
            for s in states
            if isinstance(s, dict) and s.get("user_id") is not None and s.get("channel_id")
        }
        await self._store.replace(self._key, mapping)

    async def update(self, data: dict[str, Any]) -> None:
        user_id = data.get("user_id")
        if user_id is None:
            return
        channel = data.get("channel_id")
        if channel:
            await self._store.hset(self._key, str(user_id), str(channel))
        else:
            await self._store.hdel(self._key, str(user_id))

    async def forget(self, user_id: str) -> None:
        await self._store.hdel(self._key, user_id)

    async def count(
        self, channels: Channels, hidden: frozenset[str], bots: frozenset[str]
    ) -> tuple[list[dict[str, Any]], int]:
        """(The public rooms with people, busiest first; everyone in voice.)"""
        raw = await self._store.hgetall(self._key)
        here = {u: c for u, c in raw.items() if u not in hidden and u not in bots}
        public = channels.voice_rooms()
        per_room = Counter(c for c in here.values() if c in public)
        rooms = [
            {"channel_id": cid, "name": public[cid], "member_count": n}
            for cid, n in sorted(per_room.items(), key=lambda item: (-item[1], public[item[0]]))
        ]
        return rooms, len(here)
