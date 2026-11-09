"""Domain events in, notifications out: the trigger engine with its writes
(contracts/notify.md, Topics and sources; Dedupe). Pushes and DMs follow in #225 and #226; until
then a notification lands in the inbox only."""

from __future__ import annotations

import json
import logging
import secrets
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from canccu_kit import Event

from . import engine
from .config import configured, settings_ready
from .deps import Deps

log = logging.getLogger("canccu_notify.consumer")

SOURCES = [
    "admin", "agenda", "bot", "cast", "finals", "games", "moments", "pizza", "screen",
    "tournament", "voices",
]  # fmt: skip
"""Every module that may own a topic type. The registry is read per event, so a type registered
later works at once; a module new to the platform is added here."""


def zone_of(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        log.warning("unknown time zone %r: times are shown in UTC", name)
        return ZoneInfo("UTC")


def new_id() -> str:
    # Unguessable, never a sequence: holding the id is what lets a guest read a public one.
    return secrets.token_urlsafe(16)


async def handle(d: Deps, event: Event) -> None:
    """Runs inside the event's tenant scope (the kit's subscribe_tenants)."""
    if event.tenant is None:
        return
    envelope: dict[str, Any] = json.loads(event.to_json())
    now = d.now()
    ready = await settings_ready(d.settings)
    async with d.db.tenant(event.tenant) as conn:
        tz = zone_of(await conn.fetchval("SELECT time_zone FROM notify_event_state"))
        for key, found in (await configured(conn, d.settings if ready else None)).items():
            reg, config = found["topic_type"], found["config"]
            if not config["enabled"]:
                continue  # a disabled topic gets nothing; people's choices stay
            for trigger in reg["triggers"]:
                if trigger["event"] != event.type:
                    continue
                part = reg["parts"][trigger["part"]]
                allowed = [c for c in part["channels"] if c in config["channels"]]
                for c in engine.evaluate(
                    key, trigger, allowed, config["params"], envelope, now, tz
                ):
                    await _create(conn, c, event.id, now)


async def _create(conn: Any, c: engine.Candidate, source_id: str, now: Any) -> None:
    # The key is taken only here, after every check passed, so a dropped event leaves it free.
    taken = await conn.fetchval(
        "INSERT INTO notify_dedupe (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1",
        c.dedupe_key,
    )
    if taken is None:
        return
    for user_id in c.user_ids or (None,):
        await conn.execute(
            "INSERT INTO notify_notifications (id, topic, part, audience, user_id, title, body,"
            " url, urgent, channels, source_event_id, created_at, expires_at)"
            " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
            new_id(),
            c.topic,
            c.part,
            c.audience,
            user_id,
            c.title,
            c.body,
            c.url,
            c.urgent,
            list(c.channels),
            source_id,
            now,
            c.expires_at,
        )
