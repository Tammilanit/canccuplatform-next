"""Counts, never people (D7) and chat activity (D6 B; contracts/bot.md, Counts): once a minute the
live state's counts and the minute's message counter go to `bot_counts_minute` with the minute's
events; once an hour ends its minutes are folded into `bot_counts_hour` and `bot_activity_hour`
(player-minutes) with `bot.messages.counted`.

Each minute and hour is written once (its primary key), and its events go in the same
transaction through the outbox, so a second container after a lease handover, or a tick that
runs twice, neither counts nor publishes anything twice. A message is counted in Valkey the moment
it comes (`INCR`, two hours), so a restart loses none: a minute the bot missed is written with its
messages only."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from canccu_kit import tenant_scope

from .deps import Deps

MINUTE = timedelta(minutes=1)
HOUR = timedelta(hours=1)
COUNTER_TTL_MS = 2 * 3600 * 1000
BACKFILL_MINUTES = 119
"""Minutes a restart looks back for messages; the counters live two hours."""
MINUTES_KEPT = timedelta(hours=48)


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def floor_minute(moment: datetime) -> datetime:
    return moment.replace(second=0, microsecond=0)


def messages_key(tenant: str, moment: datetime) -> str:
    return f"bot:count:{tenant}:messages:{int(floor_minute(moment).timestamp())}"


async def count_message(d: Deps, tenant: str) -> None:
    await d.keys.incr(messages_key(tenant, d.now()), COUNTER_TTL_MS)


async def _messages(d: Deps, tenant: str, minute: datetime) -> int | None:
    found = await d.keys.get(messages_key(tenant, minute))
    return None if found is None else int(found)


async def record(
    d: Deps, tenant: str, snap: dict[str, Any], flags: Mapping[str, bool], now: datetime
) -> None:
    """The minute that just ended, from `snap` (live.GuildLive.snapshot), and the minutes before
    it that the bot missed but that still hold messages."""
    minute = floor_minute(now) - MINUTE
    presence, voice, chat = (
        flags.get(f, False) for f in ("bot.presence", "bot.voice", "bot.messages")
    )
    async with d.db.tenant(tenant) as conn:
        last = await conn.fetchval("SELECT max(minute) FROM bot_counts_minute")
    start = minute - BACKFILL_MINUTES * MINUTE
    if last is not None:
        start = max(start, last + MINUTE)
    missed: list[tuple[datetime, int]] = []
    moment = start
    while chat and moment < minute:
        found = await _messages(d, tenant, moment)
        if found is not None:
            missed.append((moment, found))
        moment += MINUTE
    messages = ((await _messages(d, tenant, minute)) or 0) if chat else None
    on = {"presence": presence, "voice": voice}
    with tenant_scope(tenant):
        async with d.db.tenant(tenant) as conn:
            for at, count in missed:
                await conn.execute(
                    "INSERT INTO bot_counts_minute (minute, messages) VALUES ($1, $2)"
                    " ON CONFLICT DO NOTHING",
                    at,
                    count,
                )
            written = await conn.fetchval(
                "INSERT INTO bot_counts_minute (minute, members, online, idle, dnd, in_voice,"
                " messages, activities) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
                " ON CONFLICT DO NOTHING RETURNING minute",
                minute,
                snap["members"],
                snap["online"] if presence else None,
                snap["idle"] if presence else None,
                snap["dnd"] if presence else None,
                snap["in_voice"] if voice else None,
                messages,
                json.dumps(snap["activities"] if presence else []),
            )
            if written is not None:
                await _publish(d, conn, snap, on, iso(now))
    await d.outbox.flush(tenant)


async def _publish(
    d: Deps, conn: Any, snap: dict[str, Any], on: dict[str, bool], counted_at: str
) -> None:
    when = {"counted_at": counted_at, "interval_seconds": 60}
    if on["presence"]:
        counts = {k: snap[k] for k in ("members", "online", "idle", "dnd")}
        # With the voice feed off nobody is known to be in voice.
        in_voice = snap["in_voice"] if on["voice"] else 0
        presence = {**when, **counts, "in_voice": in_voice}
        await d.outbox.add(conn, "bot.presence.counted", presence, version=1)
        activities = {**when, "activities": snap["activities"]}
        await d.outbox.add(conn, "bot.activities.counted", activities, version=1)
    if on["voice"]:
        await d.outbox.add(conn, "bot.voice.counted", {**when, "rooms": snap["rooms"]}, version=1)


_FOLD_HOUR = """
INSERT INTO bot_counts_hour (hour, minutes, members, online, online_max, idle, dnd, in_voice,
  in_voice_max, messages)
SELECT $1, count(*), avg(members), avg(online), max(online), avg(idle), avg(dnd), avg(in_voice),
  max(in_voice), sum(messages)
FROM bot_counts_minute WHERE minute >= $1 AND minute < $1 + interval '1 hour'
ON CONFLICT DO NOTHING RETURNING messages
"""

# One minute row lists each activity once, so a sum of players over the hour's minutes is its
# player-minutes. Spellings and application ids may differ between minutes: the most common wins.
_FOLD_ACTIVITIES = """
INSERT INTO bot_activity_hour (hour, name, application_id, player_minutes, peak_players)
SELECT $1, mode() WITHIN GROUP (ORDER BY a->>'name'),
  mode() WITHIN GROUP (ORDER BY a->>'application_id'),
  sum((a->>'players')::int), max((a->>'players')::int)
FROM bot_counts_minute, jsonb_array_elements(activities) AS a
WHERE minute >= $1 AND minute < $1 + interval '1 hour'
GROUP BY lower(a->>'name')
ON CONFLICT DO NOTHING
"""


async def fold(d: Deps, tenant: str, now: datetime) -> None:
    """Every ended hour with minutes and no hour row yet; then minutes older than 48 hours go."""
    this_hour = now.replace(minute=0, second=0, microsecond=0)
    with tenant_scope(tenant):
        async with d.db.tenant(tenant) as conn:
            hours = await conn.fetch(
                "SELECT DISTINCT date_trunc('hour', minute) AS hour FROM bot_counts_minute m"
                " WHERE minute < $1 AND NOT EXISTS (SELECT 1 FROM bot_counts_hour h"
                " WHERE h.hour = date_trunc('hour', m.minute)) ORDER BY 1",
                this_hour,
            )
            for row in hours:
                hour = row["hour"]
                folded = await conn.fetchrow(_FOLD_HOUR, hour)
                if folded is None:
                    continue
                await conn.execute(_FOLD_ACTIVITIES, hour)
                if folded["messages"] is not None:
                    data = {
                        "counted_at": iso(hour),
                        "interval_seconds": 3600,
                        "messages": int(folded["messages"]),
                    }
                    await d.outbox.add(conn, "bot.messages.counted", data, version=1)
            await conn.execute(
                "DELETE FROM bot_counts_minute WHERE minute < $1", now - MINUTES_KEPT
            )
    await d.outbox.flush(tenant)
