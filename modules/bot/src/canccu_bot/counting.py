"""The minute's counts (contracts/bot.md, Counts; docs/plans/issue-122.md, D2): once a minute, each
event whose guild this client serves gets one row on Postgres with what was counted in the minute
that ended, and `bot.presence.counted`, `bot.activities.counted` and `bot.voice.counted`; a whole
hour is folded into one hour row (fold.py) with `bot.messages.counted`.

The job runs beside the client that holds the event's guild, so the client's lease (pool.py) keeps
it in one container. Nothing is lost on a restart or a moved lease: the live state and the
minutes' message counters are in Valkey, and the next run flushes every minute since the last
flushed one (two hours at most, the counters' life). A minute row and an hour row are written at
most once (their keys), so a second run never emits twice."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from canccu_kit import tenant_scope

from .client import iso
from .deps import Deps
from .feeds import Feeds, Snapshot
from .fold import Hour, Minute, fold_hour, minute_of_row
from .messages import KEEP_MS, MessageCounter, minute_of
from .router import Directory

log = logging.getLogger("canccu_bot.counting")

SETTLE_S = 2.0
"""After the minute ends, so a message counted in its last moment is in its counter."""
MINUTES_KEPT_S = 3 * 3600
"""Minute rows outlive their hour's fold by more than the counters' two hours, so a catch-up
never writes a minute twice."""


def moment(seconds: int) -> datetime:
    return datetime.fromtimestamp(seconds, UTC)


def flushed_key(tenant: str) -> str:
    return f"bot:count:{tenant}:flushed"


class Counting:
    def __init__(
        self,
        d: Deps,
        feeds: Feeds,
        directory: Directory,
        application_id: str,
        *,
        ready: Callable[[], bool],
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._d = d
        self._feeds = feeds
        self._directory = directory
        self._application_id = application_id
        self._ready = ready
        self._clock = clock
        self._sleep = sleep

    async def run(self) -> None:
        while True:
            now = self._clock()
            await self._sleep(minute_of(now) + 60 + SETTLE_S - now)
            await self.tick(self._clock())

    async def tick(self, now: float) -> None:
        for tenant, guild_id in list(self._feeds.served.items()):
            try:
                with tenant_scope(tenant):
                    await self._count(tenant, guild_id, minute_of(now))
            except Exception:
                # One event's trouble never stops another event's counts.
                log.exception("counting for %s failed", tenant)

    async def _count(self, tenant: str, guild_id: str, boundary: int) -> None:
        route = await self._directory.route(guild_id)
        ctx = await self._directory.context(tenant)
        if route != (tenant, self._application_id) or ctx is None or ctx["status"] == "archived":
            self._feeds.forget(tenant)
            return
        flags = ctx["flags"]
        snap = await self._feeds.snapshot(tenant, flags) if self._ready() else None
        minute = boundary - 60
        live = self._d.live
        last = await live.get(flushed_key(tenant))
        start = int(last) + 60 if last else boundary - KEEP_MS // 1000
        minutes = list(range(max(start, boundary - KEEP_MS // 1000), boundary, 60))
        messages_on = bool(flags.get("bot.messages"))
        counts = await MessageCounter(live, tenant).counts(minutes) if messages_on else {}
        async with self._d.db.tenant(tenant) as conn:
            folded = await _folded(conn, moment(min([*minutes, minute]) - 3600))
            for m in minutes[:-1]:
                if counts.get(m) and _hour(m) not in folded:
                    await _insert(conn, m, None, counts[m])
            messages = counts.get(minute, 0) if messages_on else None
            if snap is not None or messages is not None:
                if await _insert(conn, minute, snap, messages) and snap is not None:
                    await self._emit(conn, snap, boundary)
            await self._fold(conn, boundary - boundary % 3600)
            await conn.execute(
                "DELETE FROM bot_counts_minute WHERE minute < $1", moment(boundary - MINUTES_KEPT_S)
            )
        await live.put(flushed_key(tenant), str(minute), MINUTES_KEPT_S * 1000)
        await self._d.outbox.flush(tenant)

    async def _emit(self, conn: Any, snap: Snapshot, boundary: int) -> None:
        counted = {"counted_at": iso(moment(boundary)), "interval_seconds": 60}
        if snap.online is not None:
            presence = {
                "members": snap.members,
                "online": snap.online,
                "idle": snap.idle,
                "dnd": snap.dnd,
                "in_voice": snap.in_voice or 0,
            }
            add = self._d.outbox.add
            await add(conn, "bot.presence.counted", {**counted, **presence}, version=1)
            data = {**counted, "activities": snap.activities}
            await add(conn, "bot.activities.counted", data, version=1)
        if snap.rooms is not None:
            data = {**counted, "rooms": snap.rooms}
            await self._d.outbox.add(conn, "bot.voice.counted", data, version=1)

    async def _fold(self, conn: Any, this_hour: int) -> None:
        """Every hour that is over and not folded yet."""
        rows = await conn.fetch(
            "SELECT * FROM bot_counts_minute WHERE minute < $1 ORDER BY minute", moment(this_hour)
        )
        if not rows:
            return
        folded = await _folded(conn, rows[0]["minute"])
        by_hour: dict[int, list[Minute]] = {}
        for row in rows:
            hour = _hour(int(row["minute"].timestamp()))
            if hour not in folded:
                by_hour.setdefault(hour, []).append(minute_of_row(row))
        for hour, minutes in sorted(by_hour.items()):
            await self._write_hour(conn, fold_hour(moment(hour), minutes))

    async def _write_hour(self, conn: Any, h: Hour) -> None:
        await conn.execute(
            "INSERT INTO bot_counts_hour (hour, minutes, members, online, idle, dnd, in_voice,"
            " online_peak, in_voice_peak, messages) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,"
            " $10)",
            h.hour,
            h.minutes,
            h.members,
            h.online,
            h.idle,
            h.dnd,
            h.in_voice,
            h.online_peak,
            h.in_voice_peak,
            h.messages,
        )
        for key, (app, name, player_minutes) in h.activities.items():
            await conn.execute(
                "INSERT INTO bot_activity_hour (hour, activity_key, application_id, name,"
                " player_minutes) VALUES ($1, $2, $3, $4, $5)",
                h.hour,
                key,
                app,
                name,
                player_minutes,
            )
        if h.messages is not None:
            end = int(h.hour.timestamp()) + 3600
            data = {
                "counted_at": iso(moment(end)),
                "interval_seconds": 3600,
                "messages": h.messages,
            }
            await self._d.outbox.add(conn, "bot.messages.counted", data, version=1)


def _hour(seconds: int) -> int:
    return seconds - seconds % 3600


async def _folded(conn: Any, since: datetime) -> set[int]:
    rows = await conn.fetch("SELECT hour FROM bot_counts_hour WHERE hour >= $1", since)
    return {int(r["hour"].timestamp()) for r in rows}


async def _insert(conn: Any, minute: int, snap: Snapshot | None, messages: int | None) -> bool:
    """A minute row, at most once: False when it is there already."""
    s = snap
    inserted = await conn.fetchval(
        "INSERT INTO bot_counts_minute (minute, members, online, idle, dnd, in_voice, messages,"
        " activities) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)"
        " ON CONFLICT DO NOTHING RETURNING true",
        moment(minute),
        None if s is None else s.members,
        None if s is None else s.online,
        None if s is None else s.idle,
        None if s is None else s.dnd,
        None if s is None else s.in_voice,
        messages,
        None if s is None or s.activities is None else json.dumps(s.activities),
    )
    return bool(inserted)
