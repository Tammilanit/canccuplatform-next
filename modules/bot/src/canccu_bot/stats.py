"""`GET /api/bot/stats?hours=` (contracts/bot.md, Counts; D7): the event's hourly series and its
top games by player-hours over the last `hours` hours (24 by default, at most 72), from the
folded hours. Counts only, so a member of the event reads it, and a guest as the info-page mode
allows (contracts/tenants.md, Info pages): Screen's `stats` widget follows that mode, and this is
the same data. A game is named only when its activity matches the event's catalogue
(catalogue.py)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from canccu_kit import KitError, NotSignedIn, check_info_access
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .access import client_ip, deps, is_member, tenant_of
from .catalogue import match
from .counts import iso

DEFAULT_HOURS, MAX_HOURS = 24, 72
TOP_GAMES = 10


def _hours(request: Request) -> int:
    raw = request.query_params.get("hours")
    if raw is None:
        return DEFAULT_HOURS
    # isdigit() alone takes digits such as "²" that int() refuses.
    if not (raw.isascii() and raw.isdigit()) or not 1 <= int(raw) <= MAX_HOURS:
        raise KitError(
            f"hours is a whole number from 1 to {MAX_HOURS}", status=400, code="invalid_request"
        )
    return int(raw)


def _number(value: Any) -> float | None:
    return None if value is None else round(float(value), 2)


async def _guest_check(request: Request) -> None:
    """403 `info_pages_closed` for a guest the event's info-page mode keeps out (a draft event,
    `sign_in`, or `venue_only` from off the venue), as agenda's `viewer()` does."""
    try:
        session = await deps(request).rights.session(request.headers.get("cookie"))
    except NotSignedIn:
        session = None
    if session is None or not is_member(session):
        check_info_access(tenant_of(request), client_ip=client_ip(request), viewer="guest")


async def get_stats(request: Request) -> Response:
    d = deps(request)
    tenant = tenant_of(request)["tenant_id"]
    await _guest_check(request)
    since = d.now().replace(minute=0, second=0, microsecond=0) - timedelta(hours=_hours(request))
    async with d.db.tenant(tenant) as conn:
        hours = await conn.fetch(
            "SELECT hour, online, online_max, in_voice, messages FROM bot_counts_hour"
            " WHERE hour >= $1 ORDER BY hour",
            since,
        )
        played = await conn.fetch(
            "SELECT name, application_id, sum(player_minutes) AS minutes FROM bot_activity_hour"
            " WHERE hour >= $1 GROUP BY name, application_id",
            since,
        )
    games = await d.catalogue(tenant) if played else []
    minutes: dict[str, int] = {}
    names: dict[str, str] = {}
    for row in played:
        game = match(row["name"], row["application_id"], games)
        if game is not None:
            minutes[game["id"]] = minutes.get(game["id"], 0) + int(row["minutes"])
            names[game["id"]] = str(game["name"])
    top = sorted(minutes.items(), key=lambda g: (-g[1], names[g[0]]))[:TOP_GAMES]
    body = {
        "hours": [
            {
                "hour": iso(h["hour"]),
                "online": _number(h["online"]),
                "online_max": h["online_max"],
                "in_voice": _number(h["in_voice"]),
                "messages": h["messages"],
            }
            for h in hours
        ],
        "top_games": [
            {"game_id": gid, "name": names[gid], "player_hours": round(m / 60, 2)} for gid, m in top
        ],
    }
    return JSONResponse(body)


ROUTES = [Route("/api/bot/stats", get_stats, methods=["GET"])]
