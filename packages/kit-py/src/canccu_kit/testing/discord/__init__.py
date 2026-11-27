"""A fake Discord (REST and gateway) for the bot's tests, in-process or as the CI container
(`python -m canccu_kit.testing.discord`, deploy/compose.ci.yml). Never a real guild, token or id."""

from .fake import FakeDiscord
from .gateway import FakeGateway, GatewayClosed, MemoryTransport, Transport
from .model import FakeApplication, FakeGuild, FakeRequest, Intents

__all__ = [
    "FakeApplication",
    "FakeDiscord",
    "FakeGateway",
    "FakeGuild",
    "FakeRequest",
    "GatewayClosed",
    "Intents",
    "MemoryTransport",
    "Transport",
]
