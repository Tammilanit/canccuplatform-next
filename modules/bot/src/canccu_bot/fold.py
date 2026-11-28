"""The hourly fold and the top games (port of the legacy `stats_history` and `game_play_duration`,
with changes: step 6 plan, D7).

The legacy kept a snapshot per tick and weighted each by the time to the next tick, capped at a
maximum gap, so a game was credited player-seconds only while it was seen. Here the ticks are the
counted minutes: each minute row credits its players one minute, and a minute nobody counted (the
bot was away) credits nothing, the same cap at its tightest. An hour keeps averages and peaks
(the legacy's hourly buckets on the Unix hour) and player-minutes per activity; never a person."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

TOP_GAMES = 10


@dataclass(frozen=True)
class Minute:
    minute: datetime
    members: int | None
    online: int | None
    idle: int | None
    dnd: int | None
    in_voice: int | None
    messages: int | None
    activities: list[dict[str, Any]] | None
    """`[{application_id, name, players}]`, or None when presence was not counted that minute."""


@dataclass(frozen=True)
class Hour:
    hour: datetime
    minutes: int
    """Minutes whose presence was counted."""
    members: float | None
    online: float | None
    idle: float | None
    dnd: float | None
    in_voice: float | None
    online_peak: int | None
    in_voice_peak: int | None
    messages: int | None
    activities: dict[str, tuple[str | None, str, int]] = field(default_factory=dict)
    """activity key → (application id, name, player-minutes)."""


def activity_key(application_id: str | None, name: str) -> str:
    return f"app:{application_id}" if application_id else f"name:{name.casefold()}"


def _average(values: list[int]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


def fold_hour(hour: datetime, minutes: list[Minute]) -> Hour:
    def present(name: str) -> list[int]:
        return [v for m in minutes if (v := getattr(m, name)) is not None]

    online, in_voice, messages = present("online"), present("in_voice"), present("messages")
    player_minutes: Counter[str] = Counter()
    names: dict[str, Counter[str]] = {}
    apps: dict[str, str | None] = {}
    for m in minutes:
        for a in m.activities or []:
            key = activity_key(a.get("application_id"), str(a.get("name")))
            player_minutes[key] += int(a.get("players") or 0)
            names.setdefault(key, Counter())[str(a.get("name"))] += 1
            apps[key] = a.get("application_id")
    return Hour(
        hour=hour,
        minutes=len(online),
        members=_average(present("members")),
        online=_average(online),
        idle=_average(present("idle")),
        dnd=_average(present("dnd")),
        in_voice=_average(in_voice),
        online_peak=max(online, default=None),
        in_voice_peak=max(in_voice, default=None),
        messages=sum(messages) if messages else None,
        activities={
            key: (apps[key], names[key].most_common(1)[0][0], n)
            for key, n in player_minutes.items()
        },
    )


def top_games(rows: list[tuple[str | None, str, int]]) -> list[dict[str, Any]]:
    """(application id, name, player-minutes) rows of many hours → the busiest games by
    player-hours. An activity with no application id carries a name its player typed, which never
    reaches a board unmoderated (contracts/bot.md, Who plays what): those add up to one entry with
    no name."""
    minutes: Counter[str | None] = Counter()
    names: dict[str, Counter[str]] = {}
    for app, name, n in rows:
        minutes[app] += n
        if app is not None:
            names.setdefault(app, Counter())[name] += n
    out = [
        {
            "application_id": app,
            "name": None if app is None else names[app].most_common(1)[0][0],
            "player_hours": round(n / 60, 2),
        }
        for app, n in minutes.items()
        if n > 0
    ]
    out.sort(key=lambda g: (-g["player_hours"], g["name"] is None, g["name"] or ""))
    return out[:TOP_GAMES]
