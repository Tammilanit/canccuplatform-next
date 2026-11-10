"""Domain events in, notifications out: the trigger engine with its writes
(contracts/notify.md, Topics and sources; Dedupe). Each notification's pushes and DMs are planned
in the same transaction and sent after it commits (delivery.py, dm.py). The same streams carry
what Notify follows besides: the agenda's quiet hours, the bot's state and entity merges."""

from __future__ import annotations

import json
import logging
import secrets
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from canccu_kit import Event

from . import delivery, dm, engine, follows, quiet
from .access import is_member
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
    async with d.db.tenant(event.tenant) as conn:
        state = await conn.fetchrow("SELECT time_zone, status FROM notify_event_state")
    if state is not None and state["status"] == "archived":
        return  # an archived event's people are gone, and nothing is delivered there
    if event.type.startswith("agenda."):
        await quiet.handle(d, event)
    elif event.type.startswith("bot."):
        await dm.handle_bot(d, event)
    async with d.db.platform() as conn:
        listening = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM notify_topic_types,"
            " jsonb_array_elements(registration -> 'triggers') AS t WHERE t ->> 'event' = $1)"
            " OR EXISTS (SELECT 1 FROM notify_topic_types WHERE $1 IN ("
            " registration #>> '{parts,personal,entity,merged,event}',"
            " registration #>> '{parts,personal,entity,removed,event}'))",
            event.type,
        )
    if not listening:
        return  # most events on the streams: no settings, registry or config read for them
    envelope: dict[str, Any] = json.loads(event.to_json())
    now = d.now()
    ready = await settings_ready(d.settings)
    fallback = delivery.event_fallback(d, ready)
    planned = 0
    async with d.db.tenant(event.tenant) as conn:
        tz = zone_of(state["time_zone"] if state is not None else None)
        closed = await delivery.guests_closed(conn)
        everything = await configured(conn, d.settings if ready else None)
        await follows.on_entity_event(conn, everything, envelope)
        for key, found in everything.items():
            reg, config = found["topic_type"], found["config"]
            if not config["enabled"]:
                continue  # a disabled topic gets nothing; people's choices stay
            for trigger in reg["triggers"]:
                if trigger["event"] != event.type:
                    continue
                part = reg["parts"][trigger["part"]]
                allowed = [c for c in part["channels"] if c in config["channels"]]
                defaults = topic_info(found)["scopes"][trigger["part"]]["defaults"]
                based_on = found["custom"]["based_on"] if "custom" in found else None
                entity = part["entity"]["type"] if part["scope"] == "entity" else None
                for c in engine.evaluate(
                    key, trigger, allowed, config["params"], envelope, now, tz
                ):
                    for note in await _create(conn, c, event.id, now, based_on, entity):
                        pushes = await delivery.plan(
                            conn, note, defaults.get("push", False), closed, now
                        )
                        dms = await dm.plan(
                            conn, note, defaults.get(dm.DM, False), fallback, pushes, now
                        )
                        await delivery.queue(conn, dms)
                        planned += pushes + len(dms)
    if planned:
        try:
            await delivery.deliver(d, event.tenant)
        except Exception:
            # The rows are committed: the sender loop sends them on its next tick.
            log.exception("sending failed; the sender loop retries", extra={"tenant": event.tenant})


async def _recipients(conn: Any, c: engine.Candidate) -> tuple[str | None, ...]:
    """The users of a personal notification, or (None,) for one event-wide notification. An
    entity's followers count only while they are members (contracts/notify.md, Who gets it)."""
    if c.entity_id is not None:
        return tuple(u for u in await follows.followers(conn, c.topic, c.entity_id) if is_member(u))
    return c.user_ids or (None,)


async def _create(
    conn: Any,
    c: engine.Candidate,
    source_id: str,
    now: Any,
    based_on: str | None,
    entity_type: str | None,
) -> list[dict[str, Any]]:
    users = await _recipients(conn, c)
    if not users:
        return []  # nobody follows the entity: the key stays free, as for any dropped event
    # The key is taken only here, after every check passed, so a dropped event leaves it free.
    taken = await conn.fetchval(
        "INSERT INTO notify_dedupe (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1",
        c.dedupe_key,
    )
    if taken is None:
        return []
    made = []
    audience = "personal" if c.part == "personal" else c.audience
    for user_id in users:
        note = {
            "id": new_id(),
            "topic": c.topic,
            "part": c.part,
            "audience": audience,
            "user_id": user_id,
            "channels": list(c.channels),
        }
        await conn.execute(
            "INSERT INTO notify_notifications (id, topic, part, audience, user_id, title, body,"
            " url, urgent, channels, source_event_id, created_at, expires_at, based_on,"
            " entity_type, entity_id)"
            " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
            note["id"],
            c.topic,
            c.part,
            audience,
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
            entity_type if c.entity_id is not None else None,
            c.entity_id,
        )
        made.append(note)
    return made
