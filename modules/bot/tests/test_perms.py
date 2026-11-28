"""The bot's permissions in a channel, computed as Discord does: @everyone and the bot's roles,
then the channel's overwrites for @everyone, for the bot's roles and for the bot itself."""

from __future__ import annotations

from canccu_bot.perms import (
    ADMINISTRATOR,
    EMBED_LINKS,
    PIN_MESSAGES,
    SEND_MESSAGES,
    VIEW_CHANNEL,
    in_channel,
    names,
    top_position,
)

GUILD = "100000000000000010"
BOT_ROLE = "100000000000000011"
CREW = "100000000000000012"
BOT_USER = "100000000000000013"


def roles(everyone: int = 0, bot: int = 0) -> dict[str, dict[str, object]]:
    return {
        GUILD: {"id": GUILD, "position": 0, "permissions": str(everyone)},
        BOT_ROLE: {"id": BOT_ROLE, "position": 3, "permissions": str(bot)},
        CREW: {"id": CREW, "position": 1, "permissions": "0"},
    }


def ow(target: str, kind: int, allow: int = 0, deny: int = 0) -> dict[str, object]:
    return {"id": target, "type": kind, "allow": str(allow), "deny": str(deny)}


def test_the_roles_add_up_and_everyone_counts() -> None:
    got = in_channel(GUILD, roles(VIEW_CHANNEL, SEND_MESSAGES), [BOT_ROLE], BOT_USER, [])
    assert got == VIEW_CHANNEL | SEND_MESSAGES


def test_an_everyone_deny_is_lifted_by_a_role_allow_and_a_member_overwrite_wins() -> None:
    base = roles(VIEW_CHANNEL | SEND_MESSAGES)
    denied = [ow(GUILD, 0, deny=SEND_MESSAGES)]
    assert in_channel(GUILD, base, [BOT_ROLE], BOT_USER, denied) == VIEW_CHANNEL
    lifted = [*denied, ow(BOT_ROLE, 0, allow=SEND_MESSAGES | PIN_MESSAGES)]
    assert in_channel(GUILD, base, [BOT_ROLE], BOT_USER, lifted) == (
        VIEW_CHANNEL | SEND_MESSAGES | PIN_MESSAGES
    )
    mine = [*lifted, ow(BOT_USER, 1, deny=PIN_MESSAGES)]
    assert in_channel(GUILD, base, [BOT_ROLE], BOT_USER, mine) == VIEW_CHANNEL | SEND_MESSAGES


def test_a_role_the_bot_does_not_hold_changes_nothing() -> None:
    base = roles(VIEW_CHANNEL)
    other = [ow(CREW, 0, allow=SEND_MESSAGES)]
    assert in_channel(GUILD, base, [BOT_ROLE], BOT_USER, other) == VIEW_CHANNEL


def test_administrator_holds_everything_whatever_the_channel_says() -> None:
    denied = [ow(GUILD, 0, deny=VIEW_CHANNEL)]
    got = in_channel(GUILD, roles(bot=ADMINISTRATOR), [BOT_ROLE], BOT_USER, denied)
    assert got & VIEW_CHANNEL and got & PIN_MESSAGES


def test_the_bots_place_is_its_highest_role() -> None:
    assert top_position(roles(), [CREW, BOT_ROLE]) == 3
    assert top_position(roles(), []) == 0


def test_names_are_the_words_discord_shows() -> None:
    assert names(SEND_MESSAGES | EMBED_LINKS) == ["Send messages", "Embed links"]
