"""Discord's permission bits the setup and the check use, and the bot's permissions in a channel
computed the way Discord computes them (developer docs, Permissions: Permission Overwrites), so the
check says what Discord will refuse before anything is sent."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

ADMINISTRATOR = 1 << 3
MANAGE_CHANNELS = 1 << 4
VIEW_CHANNEL = 1 << 10
SEND_MESSAGES = 1 << 11
EMBED_LINKS = 1 << 14
READ_MESSAGE_HISTORY = 1 << 16
MOVE_MEMBERS = 1 << 24
MANAGE_ROLES = 1 << 28
# Split from Manage Messages by Discord in 2025: pinning needs this bit on its own.
PIN_MESSAGES = 1 << 51
ALL = (1 << 53) - 1

_NAMES = {
    ADMINISTRATOR: "Administrator",
    MANAGE_CHANNELS: "Manage channels",
    VIEW_CHANNEL: "View channel",
    SEND_MESSAGES: "Send messages",
    EMBED_LINKS: "Embed links",
    READ_MESSAGE_HISTORY: "Read message history",
    MOVE_MEMBERS: "Move members",
    MANAGE_ROLES: "Manage roles",
    PIN_MESSAGES: "Pin messages",
}


def names(bits: int) -> list[str]:
    """The bits as Discord's settings name them, lowest bit first."""
    return [name for bit, name in sorted(_NAMES.items()) if bits & bit]


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def base(guild_id: str, roles: Mapping[str, Mapping[str, Any]], held: Iterable[str]) -> int:
    """The server-wide permissions: @everyone's (its role id is the guild's) and the held roles'."""
    bits = _int(roles.get(guild_id, {}).get("permissions"))
    for role_id in held:
        bits |= _int(roles.get(role_id, {}).get("permissions"))
    return ALL if bits & ADMINISTRATOR else bits


def in_channel(
    guild_id: str,
    roles: Mapping[str, Mapping[str, Any]],
    held: list[str],
    user_id: str,
    overwrites: Iterable[Mapping[str, Any]],
) -> int:
    """The permissions in one channel: @everyone's overwrite, then the held roles' together, then
    the member's own, each deny before its allow."""
    bits = base(guild_id, roles, held)
    if bits == ALL:
        return ALL
    by_id = {str(o.get("id")): o for o in overwrites}
    everyone = by_id.get(guild_id)
    if everyone is not None:
        bits = (bits & ~_int(everyone.get("deny"))) | _int(everyone.get("allow"))
    allow = deny = 0
    for role_id in held:
        found = by_id.get(role_id)
        if found is not None and found.get("type") == 0:
            allow |= _int(found.get("allow"))
            deny |= _int(found.get("deny"))
    bits = (bits & ~deny) | allow
    mine = by_id.get(user_id)
    if mine is not None and mine.get("type") == 1:
        bits = (bits & ~_int(mine.get("deny"))) | _int(mine.get("allow"))
    return bits


def top_position(roles: Mapping[str, Mapping[str, Any]], held: Iterable[str]) -> int:
    """The bot's place in the role order: Discord lets it manage only roles below this."""
    return max((_int(roles.get(r, {}).get("position")) for r in held), default=0)
