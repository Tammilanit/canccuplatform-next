"""The event's games catalogue, for the stats' top games (contracts/bot.md, Counts): an activity
name is free text a guild member controls, so only an activity that matches a game of the
catalogue is ever named to people (contracts/bot.md, Who plays what).

Seam: `games_catalogue` answers the empty catalogue until the Games track's module serves it
(`modules/games` has no code yet), so until then the top games list is empty; the activities'
player-minutes are kept meanwhile, and match once the catalogue is read."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any


async def games_catalogue(tenant: str) -> list[dict[str, Any]]:
    """The event's games as `GET /api/games/catalogue/{game_id}` returns each, hidden and merged
    ones included."""
    del tenant
    return []


def _key(name: str) -> str:
    return " ".join(name.split()).casefold()


def match(
    name: str, application_id: str | None, games: Iterable[dict[str, Any]]
) -> dict[str, Any] | None:
    """The games contract's rule (contracts/games.md, The catalogue): the application id first,
    then the name aliases trimmed and without case. A hidden or merged game never matches."""
    active = [g for g in games if g.get("status") == "active"]
    ids = {a: g for g in active for a in (g.get("discord") or {}).get("application_ids") or []}
    if application_id is not None and application_id in ids:
        return ids[application_id]
    for g in active:
        aliases = (g.get("discord") or {}).get("name_aliases") or []
        if _key(name) in {_key(a) for a in aliases}:
            return g
    return None
