"""Discord DMs (contracts/notify.md, Delivery rules, Discord DMs; plan D9).

Notify never talks to Discord: it emits `notify.dm.requested` and the bot sends the DM. A DM is a
`notify_deliveries` row like a push (channel `discord_dm`, recipient `user:<id>`), so the hourly
cap, quiet hours and the sender loop treat both alike. Rows are made only while the bot says it
can send (a bound guild, its client neither paused nor failed), and checked again when sent.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from canccu_kit import Event

from . import people
from .access import is_member
from .deps import Deps

log = logging.getLogger("canccu_notify.dm")
DM = "discord_dm"
STOPPED = frozenset({"paused", "failed"})
Row = tuple[str, str, str, str | None, str | None, datetime]
"""(notification_id, recipient, channel, subscription_id, reason, created_at): a delivery row."""


async def handle_bot(d: Deps, event: Event) -> None:
    """The bot's guild binding and client status for the event, inside its tenant scope."""
    if event.type == "bot.guild.bound":
        column, value = "bot_bound", True
    elif event.type == "bot.guild.unbound":
        column, value = "bot_bound", False
    elif event.type == "bot.client.changed" and isinstance(event.data.get("status"), str):
        column, value = "bot_client", event.data["status"]
    else:
        return
    async with d.db.tenant(event.tenant) as conn:
        await conn.execute(
            f"INSERT INTO notify_source_state ({column}) VALUES ($1)"
            f" ON CONFLICT (tenant_id) DO UPDATE SET {column} = $1",
            value,
        )


async def can_send(conn: Any) -> bool:
    row = await conn.fetchrow("SELECT bot_bound, bot_client FROM notify_source_state")
    return row is not None and row["bot_bound"] and row["bot_client"] not in STOPPED


def fallback_allowed(person: people.Person, note: Any, event_fallback: bool) -> bool:
    """The fallback follows `dm_fallback` (the event's and the person's) and is held back only by
    an explicit `discord_dm: false`, never by the part's default; the topic and the event must
    still offer DMs (`channels` is the notification's, already narrowed by both)."""
    return (
        note["part"] == "personal"
        and DM in note["channels"]
        and event_fallback
        and person.dm_fallback
        and person.own(note["topic"], "personal", DM) is not False
    )


async def plan(
    conn: Any, note: dict[str, Any], default: bool, event_fallback: bool, pushes: int, now: datetime
) -> list[Row]:
    """The DM rows for a new notification. `default` is the part's `discord_dm` default as the
    event offers it; `pushes` how many push rows it got, which for a personal notification are
    its user's phones: none means no push can reach them, so the fallback applies."""
    if DM not in note["channels"] or not await can_send(conn):
        return []
    if note["part"] == "personal":
        users = [note["user_id"]]
    else:
        users = [u for u in await people.known_users(conn) if is_member(u)]
    found = await people.load(conn, users)
    rows: list[Row] = []
    for user in users:
        person = found.get(user, people.NOBODY)
        if person.wants(note["topic"], note["part"], DM, default):
            reason = "channel"
        elif pushes == 0 and fallback_allowed(person, note, event_fallback):
            reason = "fallback"
        else:
            continue
        rows.append((note["id"], f"user:{user}", DM, None, reason, now))
    return rows


async def fallbacks(
    conn: Any, notification_ids: list[str], event_fallback: bool, now: datetime
) -> list[Row]:
    """Fallback rows for personal notifications whose every push to their user failed. A person
    gets at most one DM per notification, so one that already has a DM row gets none."""
    if not notification_ids or not await can_send(conn):
        return []
    notes = await conn.fetch(
        "SELECT n.id, n.topic, n.part, n.user_id, n.channels FROM notify_notifications n"
        " WHERE n.id = ANY($1::text[]) AND n.part = 'personal' AND NOT EXISTS ("
        "   SELECT 1 FROM notify_deliveries x WHERE x.notification_id = n.id"
        "   AND x.recipient = 'user:' || n.user_id"
        "   AND (x.channel = 'discord_dm' OR x.status NOT IN ('failed', 'skipped')))",
        notification_ids,
    )
    found = await people.load(conn, [n["user_id"] for n in notes])
    return [
        (n["id"], f"user:{n['user_id']}", DM, None, "fallback", now)
        for n in notes
        if fallback_allowed(found.get(n["user_id"], people.NOBODY), n, event_fallback)
    ]


async def discord_ids(d: Deps, tenant: str, user_ids: set[str]) -> dict[str, str | None]:
    """Read when the DM is requested, never taken from the source event (the contract's rule)."""
    users = sorted(user_ids)
    answers = await asyncio.gather(*(d.users.discord_id(u) for u in users), return_exceptions=True)
    out: dict[str, str | None] = {}
    for user, answer in zip(users, answers, strict=True):
        if isinstance(answer, BaseException):
            log.error("Discord id read failed: %s", type(answer).__name__, extra={"tenant": tenant})
            answer = None
        elif answer is None:
            log.warning("the tenants module knows no Discord id: no DM", extra={"tenant": tenant})
        out[user] = answer
    return out


async def request(d: Deps, conn: Any, jobs: list[Any], ids: dict[str, str | None]) -> list[Any]:
    """`notify.dm.requested` for each claimed DM row, through the outbox in the caller's
    transaction; returns each row's final status."""
    done = []
    for row in jobs:
        user = row["recipient"].removeprefix("user:")
        discord = ids.get(user)
        if discord is None:
            done.append((row["id"], "failed"))
            continue
        data = {
            "user_id": user,
            "discord_user_id": discord,
            "notification_id": row["notification_id"],
            "topic": row["topic"],
            "title": row["title"],
            "body": row["body"],
            "url": row["url"],
            "urgent": row["urgent"],
            "reason": row["reason"],
        }
        await d.outbox.add(conn, "notify.dm.requested", data, version=1)
        done.append((row["id"], "sent"))
    return done
