"""What the fake Discord keeps: applications, guilds with their channels, roles and members, and
the record of every request. Plain data, so a test sets up a server by writing it."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class Intents:
    """Gateway intent bits (Discord's numbers)."""

    NONE = 0
    GUILDS = 1 << 0
    GUILD_MEMBERS = 1 << 1
    GUILD_VOICE_STATES = 1 << 7
    GUILD_PRESENCES = 1 << 8
    GUILD_MESSAGES = 1 << 9
    MESSAGE_CONTENT = 1 << 15
    PRIVILEGED = GUILD_MEMBERS | GUILD_PRESENCES | MESSAGE_CONTENT


@dataclass
class FakeApplication:
    id: str
    name: str
    token: str
    client_secret: str
    bot_user_id: str
    privileged: int = Intents.PRIVILEGED
    """The privileged intents enabled in the developer portal; identify asks for no others."""


@dataclass
class FakeGuild:
    id: str
    name: str
    owner_id: str
    bots: set[str] = field(default_factory=set)
    """Application ids whose bot is in the guild."""
    channels: dict[str, dict[str, Any]] = field(default_factory=dict)
    roles: dict[str, dict[str, Any]] = field(default_factory=dict)
    members: dict[str, dict[str, Any]] = field(default_factory=dict)
    commands: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    """Registered commands per application id."""

    def as_payload(self) -> dict[str, Any]:
        """The guild as GUILD_CREATE carries it."""
        return {
            "id": self.id,
            "name": self.name,
            "owner_id": self.owner_id,
            "channels": list(self.channels.values()),
            "roles": list(self.roles.values()),
            "members": list(self.members.values()),
            "member_count": len(self.members),
        }


@dataclass
class FakeRequest:
    application_id: str | None
    """Whose token called; None for a token the fake does not know."""
    method: str
    path: str
    """Below /api/v10, e.g. `/users/@me`."""
    body: Any
    status: int


@dataclass
class ScriptedFailure:
    status: int
    path: str | None
    global_: bool
    retry_after: float
    times: int
