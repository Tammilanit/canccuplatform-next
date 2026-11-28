"""People in voice: a port of the legacy `voice_tracker`, which counted the people (never bots) in
each voice channel. `in_voice` counts every voice channel, as the legacy did, and is only a
number; a room is listed by name only when everyone in the guild can see it (contracts/bot.md,
Who plays what), so a private room's name never reaches a screen."""

from __future__ import annotations

from collections import Counter
from typing import Any

from .presence_tracker import is_bot
from .tracked import Tracked


class VoiceTracker:
    def __init__(self) -> None:
        self.states = Tracked()
        """Discord id → the voice channel id they are in."""

    def slices(self) -> dict[str, Tracked]:
        return {"voice": self.states}

    def guild(self, data: dict[str, Any]) -> None:
        if "voice_states" in data:
            self.states.clear()
            for s in data["voice_states"]:
                self.update(s)

    def update(self, data: dict[str, Any]) -> None:
        uid = data.get("user_id")
        if uid is None:
            return
        member = data.get("member")
        channel = data.get("channel_id")
        if channel is None or (isinstance(member, dict) and is_bot(member)):
            self.states.drop(str(uid))
        else:
            self.states.set(str(uid), str(channel))

    def count(
        self, hidden: frozenset[str], bots: frozenset[str], rooms: dict[str, str]
    ) -> tuple[int, list[dict[str, Any]]]:
        """(people in voice, the public rooms with people in them, busiest first)."""
        per_room = Counter(
            channel
            for uid, channel in self.states.values.items()
            if uid not in hidden and uid not in bots
        )
        listed: list[dict[str, Any]] = [
            {"channel_id": cid, "name": rooms[cid], "member_count": n}
            for cid, n in per_room.items()
            if cid in rooms
        ]
        listed.sort(key=lambda r: (-r["member_count"], r["name"]))
        return sum(per_room.values()), listed
