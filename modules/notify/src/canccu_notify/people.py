"""Each person's own choices at an event: `dm_fallback` and channels per topic and part
(contracts/notify.md, Per-person channels and follows). Only explicit choices are stored, so a
choice left out keeps following the part's default, and the DM fallback can tell the two apart."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Person:
    dm_fallback: bool = True
    channels: dict[str, Any] = field(default_factory=dict)

    def own(self, topic: str, part: str, channel: str) -> bool | None:
        value = self.channels.get(topic, {}).get(part, {}).get(channel)
        return value if isinstance(value, bool) else None

    def wants(self, topic: str, part: str, channel: str, default: bool) -> bool:
        own = self.own(topic, part, channel)
        return default if own is None else own

    def view(self) -> dict[str, Any]:
        return {"dm_fallback": self.dm_fallback, "channels": self.channels}


NOBODY = Person()
"""Someone who never set anything: every default."""


def _person(row: Any) -> Person:
    return Person(row["dm_fallback"], json.loads(row["channels"]))


async def load(conn: Any, user_ids: list[str]) -> dict[str, Person]:
    rows = await conn.fetch(
        "SELECT user_id, dm_fallback, channels FROM notify_people WHERE user_id = ANY($1::text[])",
        user_ids,
    )
    return {r["user_id"]: _person(r) for r in rows}


async def one(conn: Any, user_id: str) -> Person:
    return (await load(conn, [user_id])).get(user_id, NOBODY)


async def known_users(conn: Any) -> list[str]:
    """The users Notify knows at the event: those with choices or a phone. Notify has no member
    list, so an event-wide DM by choice can reach only them."""
    rows = await conn.fetch(
        "SELECT user_id FROM notify_people UNION"
        " SELECT user_id FROM notify_subscriptions WHERE user_id IS NOT NULL ORDER BY 1"
    )
    return [r["user_id"] for r in rows]


async def save(conn: Any, user_id: str, person: Person) -> None:
    await conn.execute(
        "INSERT INTO notify_people (user_id, dm_fallback, channels) VALUES ($1, $2, $3)"
        " ON CONFLICT (tenant_id, user_id) DO UPDATE SET dm_fallback = $2, channels = $3",
        user_id,
        person.dm_fallback,
        json.dumps(person.channels),
    )
