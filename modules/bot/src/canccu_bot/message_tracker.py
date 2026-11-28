"""Chat activity (D6 B): whether a message counts. The legacy `message_tracker` kept every
author's name and count for a top-chatters board; that is dropped (D6). Here the author's id is
read only to leave out bots and people who hid, and nothing of the message is kept but a count
(`feeds.py`). Message content is never asked for (D5)."""

from __future__ import annotations

from typing import Any

from .channels import PublicChannels

DEFAULT, REPLY = 0, 19
"""People's own posts; join notices, pins and the like are Discord's, not chat."""


def counts(data: dict[str, Any], channels: PublicChannels, hidden: frozenset[str]) -> bool:
    author = data.get("author")
    if data.get("guild_id") is None or data.get("webhook_id") is not None:
        return False
    if not isinstance(author, dict) or author.get("bot") is True:
        return False
    if data.get("type") not in (DEFAULT, REPLY) or str(author.get("id")) in hidden:
        return False
    return channels.is_public(str(data.get("channel_id")))
