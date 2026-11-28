"""Chat activity (D6 B): messages counted per minute in the channels everyone can read; bots,
webhooks, system messages and people who hid dropped; no content, author or channel kept."""

from __future__ import annotations

from typing import Any

from fakes import MemoryLive

from canccu_bot.channels import Channels
from canccu_bot.messages import MessageCounter, minute_of

T = "ev-a"
GUILD = "100000000000000001"
VIEW = 1 << 10
AT = 1_800_000_000.0  # a whole minute


def channels() -> Channels:
    closed = {"id": GUILD, "type": 0, "allow": "0", "deny": str(VIEW)}
    return Channels(
        GUILD,
        VIEW,
        {
            "10": {"t": 0, "n": "general", "p": None, "o": None},
            "11": {"t": 0, "n": "crew", "p": None, "o": closed},
        },
    )


def message(author: str = "1", channel: str = "10", **more: Any) -> dict[str, Any]:
    return {
        "id": "5",
        "guild_id": GUILD,
        "channel_id": channel,
        "type": 0,
        "author": {"id": author, "username": "someone"},
        **more,
    }


def counter(live: MemoryLive, now: float = AT + 5) -> MessageCounter:
    return MessageCounter(live, T, clock=lambda: now)


async def test_a_message_in_a_public_channel_is_counted_in_its_minute() -> None:
    live = MemoryLive()
    await counter(live).seen(message(), channels(), frozenset())
    await counter(live).seen(message(type=19), channels(), frozenset())  # a reply

    assert await counter(live).counts([minute_of(AT)]) == {minute_of(AT): 2}


async def test_private_channels_bots_webhooks_system_messages_and_hidden_people_are_dropped() -> (
    None
):
    live = MemoryLive()
    c = counter(live)
    dropped = [
        message(channel="11"),
        message(channel="99"),
        {**message(), "author": {"id": "9", "bot": True}},
        message(webhook_id="44"),
        message(type=7),  # someone joined
        message(author="2"),
    ]
    for data in dropped:
        assert not await c.seen(data, channels(), frozenset({"2"}))

    assert await c.counts([minute_of(AT)]) == {}


async def test_nothing_of_the_message_is_kept_but_the_count() -> None:
    live = MemoryLive()
    await counter(live).seen(
        message(content="hello world", author="123456789012345678"), channels(), frozenset()
    )

    kept = repr(live.values)
    assert "hello" not in kept and "123456789012345678" not in kept and "general" not in kept


async def test_counts_keep_their_minute_and_expire_after_two_hours() -> None:
    live = MemoryLive()
    await counter(live, AT + 5).seen(message(), channels(), frozenset())
    await counter(live, AT + 65).seen(message(), channels(), frozenset())

    assert await counter(live).counts([minute_of(AT), minute_of(AT + 60)]) == {
        minute_of(AT): 1,
        minute_of(AT + 60): 1,
    }
    live.now_ms = 2 * 3600 * 1000 + 1
    assert await counter(live).counts([minute_of(AT)]) == {}
