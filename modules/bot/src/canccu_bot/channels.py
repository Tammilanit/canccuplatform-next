"""Which of the guild's channels everyone in it can see (D4): the ones whose @everyone role, after
the channel's own overwrite for @everyone, holds View channel. Chat activity counts only there,
and only those voice rooms are named. A thread is public when it is not a private thread and its
channel is public. A channel the bot has not been told about counts as private."""

from __future__ import annotations

import json
from typing import Any

from .perms import ADMINISTRATOR, VIEW_CHANNEL, bits_of
from .tracked import Tracked

TEXT, VOICE, CATEGORY, ANNOUNCEMENT, STAGE, FORUM, MEDIA = 0, 2, 4, 5, 13, 15, 16
ANNOUNCEMENT_THREAD, PUBLIC_THREAD, PRIVATE_THREAD = 10, 11, 12
ROOMS = (VOICE, STAGE)
_EVERYONE, _GUILD = "@everyone", "@guild"


class PublicChannels:
    def __init__(self) -> None:
        self.known = Tracked()
        """Channel id → JSON `{t, p, a, d, n}`: type, parent, the @everyone overwrite's allow and
        deny, and a voice room's name; `@everyone` → the role's permissions; `@guild` → the
        guild's id, which is also @everyone's role id."""

    def slices(self) -> dict[str, Tracked]:
        return {"channels": self.known}

    @property
    def guild_id(self) -> str | None:
        return self.known.get(_GUILD)

    def guild(self, data: dict[str, Any]) -> None:
        self.known.replace({_GUILD: str(data.get("id"))})
        for role in data.get("roles") or []:
            self._role(role)
        for channel in data.get("channels") or []:
            self._channel(channel)
        for thread in data.get("threads") or []:
            self._channel(thread)

    def update(self, event: str, data: dict[str, Any]) -> None:
        if event in ("GUILD_ROLE_CREATE", "GUILD_ROLE_UPDATE"):
            if self.guild_id is None:
                self.known.set(_GUILD, str(data.get("guild_id")))
            self._role(data.get("role") or {})
        elif event in ("CHANNEL_DELETE", "THREAD_DELETE"):
            self.known.drop(str(data.get("id")))
        else:
            self._channel(data)

    def _role(self, role: dict[str, Any]) -> None:
        if self.guild_id is not None and str(role.get("id")) == self.guild_id:
            self.known.set(_EVERYONE, str(bits_of(role.get("permissions"))))

    def _channel(self, data: dict[str, Any]) -> None:
        if data.get("id") is None:
            return
        kind = data.get("type")
        entry: dict[str, Any] = {"t": kind, "p": data.get("parent_id"), "a": 0, "d": 0}
        for o in data.get("permission_overwrites") or []:
            if str(o.get("id")) == self.guild_id:
                entry["a"], entry["d"] = bits_of(o.get("allow")), bits_of(o.get("deny"))
        if kind in ROOMS:
            entry["n"] = str(data.get("name") or "")
        self.known.set(str(data["id"]), json.dumps(entry))

    def _entry(self, channel_id: str) -> dict[str, Any] | None:
        raw = self.known.get(channel_id)
        return None if raw is None or channel_id.startswith("@") else dict(json.loads(raw))

    def _visible(self, entry: dict[str, Any]) -> bool:
        base = int(self.known.get(_EVERYONE) or 0)
        if base & ADMINISTRATOR:
            return True
        return bool(((base & ~entry["d"]) | entry["a"]) & VIEW_CHANNEL)

    def is_public(self, channel_id: str) -> bool:
        entry = self._entry(channel_id)
        if entry is None or entry["t"] == CATEGORY:
            return False
        if entry["t"] in (ANNOUNCEMENT_THREAD, PUBLIC_THREAD):
            parent = entry["p"]
            return parent is not None and self.is_public(str(parent))
        if entry["t"] == PRIVATE_THREAD:
            return False
        return self._visible(entry)

    def voice_rooms(self) -> dict[str, str]:
        """Public voice and stage channels, by id, with their names."""
        out = {}
        for cid in self.known.values:
            entry = self._entry(cid)
            if entry is not None and entry["t"] in ROOMS and self.is_public(cid):
                out[cid] = entry["n"]
        return out
