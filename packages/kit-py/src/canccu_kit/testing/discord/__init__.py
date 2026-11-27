"""A fake Discord (REST and gateway) for the bot's tests, in-process or as the CI container
(`python -m canccu_kit.testing.discord`, deploy/compose.ci.yml). Never a real guild, token or id."""

from .fake import FakeDiscord
from .gateway import FakeGateway, GatewayClosed, MemoryTransport, Transport
from .model import (
    ADMINISTRATOR,
    MANAGE_GUILD,
    FakeApplication,
    FakeGuild,
    FakeRequest,
    FakeUser,
    Intents,
)

__all__ = [
    "ADMINISTRATOR",
    "MANAGE_GUILD",
    "FakeApplication",
    "FakeDiscord",
    "FakeGateway",
    "FakeGuild",
    "FakeRequest",
    "FakeUser",
    "GatewayClosed",
    "Intents",
    "MemoryTransport",
    "Transport",
]
