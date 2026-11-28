"""Players per "playing" activity (port of the legacy `game_detector`'s counting, with changes).

Kept from the legacy: activities counted whatever the member's status, bots skipped (by the
caller), the majority's application id. Changed: an activity with an application id is grouped by
that id, the surest match (contracts/games.md, The catalogue), and named by its most common name;
one without is grouped by its name, ignoring case and spacing, instead of title-casing names
(which mangled "CS2"-like names). Matching to the event's games is the games module's (surges)
and link 2a's (who plays what); the hot-game episode is gone to Games (D13)."""

from __future__ import annotations

from collections import Counter
from typing import Any

NAME_MAX = 100


def clean_name(name: str) -> str:
    return " ".join(name.split())[:NAME_MAX]


def count_activities(found: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """From live presence entries (presence.py), already without bots and hidden people:
    `[{application_id, name, players}]`, busiest first."""
    players: Counter[str] = Counter()
    names: dict[str, Counter[str]] = {}
    apps: dict[str, str | None] = {}
    for entry in found.values():
        seen: set[str] = set()
        for app, raw in entry.get("a") or []:
            name = clean_name(str(raw or ""))
            if not name:
                continue
            key = f"app:{app}" if app else f"name:{name.casefold()}"
            names.setdefault(key, Counter())[name] += 1
            apps[key] = str(app) if app else None
            if key not in seen:
                seen.add(key)
                players[key] += 1
    out: list[dict[str, Any]] = [
        {
            "application_id": apps[key],
            "name": names[key].most_common(1)[0][0],
            "players": n,
        }
        for key, n in players.items()
    ]
    out.sort(key=lambda a: (-a["players"], a["name"].casefold()))
    return out
