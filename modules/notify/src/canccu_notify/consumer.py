"""Domain events in, notifications out: the trigger engine with its writes
(contracts/notify.md, Topics and sources; Dedupe). Each notification's pushes are planned in the
same transaction and sent after it commits (delivery.py); Discord DMs follow in #226."""

from __future__ import annotations

import json
import logging
import secrets
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from canccu_kit import Event

from . import delivery, engine
from .config import configured, settings_ready, topic_info
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
    async with d.db.platform() as conn:
        listening = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM notify_topic_types,"
            " jsonb_array_elements(registration -> 'triggers') AS t WHERE t ->> 'event' = $1)",
            event.type,
        )
    if not listening:
        return  # most events on the streams: no settings, registry or config read for them
    envelope: dict[str, Any] = json.loads(event.to_json())
    now = d.now()
    ready = await settings_ready(d.settings)
    planned = 0
    async with d.db.tenant(event.tenant) as conn:
        tz = zone_of(await conn.fetchval("SELECT time_zone FROM notify_event_state"))
        closed = await delivery.guests_closed(conn)
        for key, found in (await configured(conn, d.settings if ready else None)).items():
            reg, config = found["topic_type"], found["config"]
            if not config["enabled"]:
                continue  # a disabled topic gets nothing; people's choices stay
            for trigger in reg["triggers"]:
                if trigger["event"] != event.type:
                    continue
                part = reg["parts"][trigger["part"]]
                allowed = [c for c in part["channels"] if c in config["channels"]]
                default = topic_info(found)["parts"][trigger["part"]]["default"]
                based_on = found["custom"]["based_on"] if "custom" in found else None
                for c in engine.evaluate(
                    key, trigger, allowed, config["params"], envelope, now, tz
                ):
                    for note in await _create(conn, c, event.id, now, based_on):
                        planned += await delivery.plan(conn, note, default, closed, now)
    if planned:
        try:
            await delivery.deliver(d, event.tenant)
        except Exception:
            # The rows are committed: the sender loop sends them on its next tick.
            log.exception("sending failed; the sender loop retries", extra={"tenant": event.tenant})


async def _create(
    conn: Any, c: engine.Candidate, source_id: str, now: Any, based_on: str | None
) -> list[dict[str, Any]]:
    # The key is taken only here, after every check passed, so a dropped event leaves it free.
    taken = await conn.fetchval(
        "INSERT INTO notify_dedupe (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1",
        c.dedupe_key,
    )
    if taken is None:
        return []
    made = []
    for user_id in c.user_ids or (None,):
        note = {
            "id": new_id(),
            "topic": c.topic,
            "part": c.part,
            "audience": c.audience,
            "user_id": user_id,
            "channels": list(c.channels),
        }
        await conn.execute(
            "INSERT INTO notify_notifications (id, topic, part, audience, user_id, title, body,"
            " url, urgent, channels, source_event_id, created_at, expires_at, based_on)"
            " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
            note["id"],
            c.topic,
            c.part,
            c.audience,
            user_id,
            c.title,
            c.body,
            c.url,
            c.urgent,
            note["channels"],
            source_id,
            now,
            c.expires_at,
            based_on,
        )
        made.append(note)
    return made
