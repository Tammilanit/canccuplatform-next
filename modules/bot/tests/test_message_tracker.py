"""Chat activity (D6 B, D4): which messages count. Only people's posts in channels everyone in the
guild can read; never a bot, a webhook, a system message or someone who hid. The public channels
follow the guild's channels, threads and the @everyone role."""

from __future__ import annotations

from typing import Any

from canccu_bot.channels import PublicChannels
from canccu_bot.message_tracker import counts
from canccu_bot.perms import SEND_MESSAGES, VIEW_CHANNEL

GUILD = "g"


def overwrite(target: str, *, allow: int = 0, deny: int = 0) -> dict[str, Any]:
    return {"id": target, "type": 0, "allow": str(allow), "deny": str(deny)}


def channel(cid: str, kind: int = 0, *overwrites: dict[str, Any], name: str = "") -> Any:
    return {
        "id": cid,
        "type": kind,
        "name": name or cid,
        "guild_id": GUILD,
        "permission_overwrites": list(overwrites),
    }


def server(everyone: int = VIEW_CHANNEL | SEND_MESSAGES) -> PublicChannels:
    c = PublicChannels()
    c.guild(
        {
            "id": GUILD,
            "roles": [{"id": GUILD, "permissions": str(everyone)}],
            "channels": [
                channel("general"),
                channel("crew", 0, overwrite(GUILD, deny=VIEW_CHANNEL)),
                channel("lobby", 2, name="Lobby"),
                channel("backstage", 2, overwrite(GUILD, deny=VIEW_CHANNEL)),
                channel("cat", 4),
            ],
            "threads": [
                {"id": "t-open", "type": 11, "parent_id": "general"},
                {"id": "t-crew", "type": 11, "parent_id": "crew"},
                {"id": "t-private", "type": 12, "parent_id": "general"},
            ],
        }
    )
    return c


def message(channel_id: str = "general", author: str = "1", **extra: Any) -> dict[str, Any]:
    return {
        "id": "m1",
        "guild_id": GUILD,
        "channel_id": channel_id,
        "type": 0,
        "author": {"id": author},
        **extra,
    }


def test_a_post_in_a_public_channel_counts() -> None:
    assert counts(message(), server(), frozenset())
    assert counts(message(type=19), server(), frozenset())  # a reply


def test_private_channels_and_their_threads_do_not_count() -> None:
    c = server()
    assert not counts(message("crew"), c, frozenset())
    assert not counts(message("t-crew"), c, frozenset())
    assert not counts(message("t-private"), c, frozenset())
    assert counts(message("t-open"), c, frozenset())


def test_an_unknown_channel_does_not_count() -> None:
    assert not counts(message("somewhere"), server(), frozenset())


def test_bots_webhooks_system_messages_and_hidden_people_do_not_count() -> None:
    c = server()
    assert not counts(message(author="9", **{"author": {"id": "9", "bot": True}}), c, frozenset())
    assert not counts(message(webhook_id="w1"), c, frozenset())
    assert not counts(message(type=7), c, frozenset())  # "joined the server"
    assert not counts(message(author="2"), c, frozenset({"2"}))


def test_a_guild_whose_everyone_cannot_view_counts_only_where_an_overwrite_allows() -> None:
    c = PublicChannels()
    c.guild(
        {
            "id": GUILD,
            "roles": [{"id": GUILD, "permissions": "0"}],
            "channels": [channel("a"), channel("b", 0, overwrite(GUILD, allow=VIEW_CHANNEL))],
        }
    )
    assert not counts(message("a"), c, frozenset())
    assert counts(message("b"), c, frozenset())


def test_channels_follow_creates_updates_deletes_and_the_role() -> None:
    c = server()
    c.update("CHANNEL_CREATE", channel("new"))
    assert c.is_public("new")
    c.update("CHANNEL_UPDATE", channel("new", 0, overwrite(GUILD, deny=VIEW_CHANNEL)))
    assert not c.is_public("new")
    c.update("CHANNEL_DELETE", channel("general"))
    assert not c.is_public("general")
    c.update("THREAD_CREATE", {"id": "t2", "type": 11, "parent_id": "lobby"})
    assert c.is_public("t2")
    c.update("GUILD_ROLE_UPDATE", {"guild_id": GUILD, "role": {"id": GUILD, "permissions": "0"}})
    assert not c.is_public("lobby")


def test_voice_rooms_are_the_public_voice_channels() -> None:
    assert server().voice_rooms() == {"lobby": "Lobby"}
