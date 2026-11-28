"""Chat activity (step 6 plan, Chat activity (D6 B); docs/plans/issue-122.md, D4): how busy the
event's Discord is, as a count of messages per minute, folded per hour with the other counts.

Discord sends no text: the bot never asks for the message-content intent (D5). The author's id is
read only to drop bots, webhooks and the people who hid, and is never stored; neither is the
channel. A message counts only in a channel everyone in the server can read (channels.py), and
only a person's message (a plain one or a reply), not a join notice or a pin. The minute's
counter lives in Valkey for two hours, so a restart or a moved lease loses no count before the
minute is flushed to Postgres (counting.py)."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from .channels import Channels
from .live import LiveStore

COUNTED_TYPES = (0, 19)
"""A plain message and a reply."""
KEEP_MS = 2 * 3600 * 1000


def minute_of(moment: float) -> int:
    """The minute a moment falls in, as Unix seconds."""
    return int(moment // 60) * 60


def counter_key(tenant: str, minute: int) -> str:
    return f"bot:count:{tenant}:messages:{minute}"


class MessageCounter:
    def __init__(
        self, store: LiveStore, tenant: str, *, clock: Callable[[], float] = time.time
    ) -> None:
        self._store = store
        self._tenant = tenant
        self._clock = clock

    async def seen(self, data: dict[str, Any], channels: Channels, hidden: frozenset[str]) -> bool:
        """MESSAGE_CREATE: counted or dropped."""
        found = data.get("author")
        author: dict[str, Any] = found if isinstance(found, dict) else {}
        if (
            data.get("webhook_id") is not None
            or author.get("bot")
            or author.get("system")
            or data.get("type") not in COUNTED_TYPES
            or str(author.get("id")) in hidden
            or not channels.public(str(data.get("channel_id")))
        ):
            return False
        await self._store.incr(counter_key(self._tenant, minute_of(self._clock())), KEEP_MS)
        return True

    async def counts(self, minutes: list[int]) -> dict[int, int]:
        """The kept counts of these minutes; a minute with no message is absent."""
        values = await self._store.mget([counter_key(self._tenant, m) for m in minutes])
        return {m: int(v) for m, v in zip(minutes, values, strict=True) if v}
