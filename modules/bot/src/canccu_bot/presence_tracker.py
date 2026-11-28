"""Members online, idle and do not disturb: a port of the legacy `presence_tracker`, which counted
the guild's members by status, skipped bots and left offline uncounted. The legacy read a
discord.py cache; here the gateway's snapshot and updates feed the tracker directly.

Only Discord ids are kept, never a name or nick (D7): a member is "bot" or "member", a status is
its word."""

from __future__ import annotations

from typing import Any

from .tracked import Tracked

STATUSES = ("online", "idle", "dnd")
_COUNT = "member_count"


def user_id(data: dict[str, Any]) -> str | None:
    user = data.get("user")
    uid = user.get("id") if isinstance(user, dict) else data.get("user_id")
    return None if uid is None else str(uid)


def is_bot(data: dict[str, Any]) -> bool:
    user = data.get("user")
    return isinstance(user, dict) and user.get("bot") is True


class PresenceTracker:
    def __init__(self) -> None:
        self.members = Tracked()
        """Discord id → `bot` or `member`: every member the gateway named."""
        self.statuses = Tracked()
        """Discord id → `online`, `idle` or `dnd`; offline is absent."""
        self.guild_count = Tracked()
        """Discord's own member count of the guild, bots included."""

    def slices(self) -> dict[str, Tracked]:
        return {"members": self.members, "presence": self.statuses, "guild": self.guild_count}

    def bots(self) -> frozenset[str]:
        return frozenset(k for k, v in self.members.values.items() if v == "bot")

    def guild(self, data: dict[str, Any]) -> None:
        if isinstance(data.get("member_count"), int):
            self.guild_count.set(_COUNT, str(data["member_count"]))
        if "members" in data:
            for m in data["members"]:
                self._member(m)
        if "presences" in data:
            # The snapshot lists everyone who is not offline: whoever it leaves out is offline.
            self.statuses.clear()
            for p in data["presences"]:
                self.presence(p)

    def _member(self, data: dict[str, Any]) -> None:
        uid = user_id(data)
        if uid is not None:
            self.members.set(uid, "bot" if is_bot(data) else "member")

    def member(self, event: str, data: dict[str, Any]) -> None:
        if event == "GUILD_MEMBERS_CHUNK":
            for m in data.get("members") or []:
                self._member(m)
            return
        uid = user_id(data)
        if uid is None:
            return
        known = self.members.get(uid) is not None
        if event == "GUILD_MEMBER_REMOVE":
            self.members.drop(uid)
            self.statuses.drop(uid)
            self._move_count(-1)
            return
        self._member(data)
        if event == "GUILD_MEMBER_ADD" and not known:
            self._move_count(1)

    def _move_count(self, by: int) -> None:
        count = self.guild_count.get(_COUNT)
        if count is not None:
            self.guild_count.set(_COUNT, str(max(int(count) + by, 0)))

    def presence(self, data: dict[str, Any]) -> None:
        uid = user_id(data)
        if uid is None:
            return
        if is_bot(data):
            self.members.set(uid, "bot")
        status = data.get("status")
        if status in STATUSES:
            self.statuses.set(uid, str(status))
        else:
            self.statuses.drop(uid)

    def count(self, hidden: frozenset[str]) -> dict[str, int]:
        bots = self.bots()
        known = sum(1 for k, v in self.members.values.items() if v == "member")
        hidden_members = sum(1 for k in hidden if self.members.get(k) == "member")
        total = self.guild_count.get(_COUNT)
        # A large guild's snapshot names only who is online, so Discord's own count holds the
        # rest; the bots and the people who hid among them are the ones the gateway named.
        members = known if total is None else max(int(total) - len(bots), known)
        out = {"members": members - hidden_members}
        for status in STATUSES:
            out[status] = sum(
                1
                for uid, s in self.statuses.values.items()
                if s == status and uid not in bots and uid not in hidden
            )
        return out
