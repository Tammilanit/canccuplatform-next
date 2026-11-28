"""`GET /api/bot/stats` (contracts/bot.md, Counts): the event's hourly series and its top games by
player-hours, built from the hourly counts (port of the legacy `stats_history`, which published a
precomputed history to the display; here it is read on demand, and the 24 hours Screen keeps of
`bot.presence.counted` stay Screen's).

Counts only, so anyone the event's info pages let in may read them, a guest included. The hour in
progress, and an hour the counting job never folded (the guild was unbound mid-hour), are folded
from their minute rows on the fly."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from canccu_kit import KitError, NotSignedIn
from canccu_kit.access import check_info_access
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .access import client_ip, deps, tenant_of
from .client import iso
from .fold import Hour, fold_hour, minute_of_row, top_games

DEFAULT_HOURS = 24
MAX_HOURS = 72
SERIES = ("members", "online", "idle", "dnd", "in_voice", "online_peak", "in_voice_peak")


def _hours(request: Request) -> int:
    raw = request.query_params.get("hours", str(DEFAULT_HOURS))
    if not raw.isdigit() or not 1 <= int(raw) <= MAX_HOURS:
        raise KitError(f"hours: 1 to {MAX_HOURS}", status=400, code="invalid_request")
    return int(raw)


def _number(value: float | None) -> float | int | None:
    """A whole average as an integer, as the counts are."""
    if value is None:
        return None
    value = round(float(value), 2)
    return int(value) if value.is_integer() else value


async def get_stats(request: Request) -> Response:
    d = deps(request)
    ctx = tenant_of(request)
    hours = _hours(request)
    try:
        await d.rights.session(request.headers.get("cookie"))
        viewer = "member"
    except NotSignedIn:
        viewer = "guest"
    check_info_access(ctx, client_ip=client_ip(request), viewer=viewer)  # type: ignore[arg-type]
    now = d.now()
    this_hour = now.replace(minute=0, second=0, microsecond=0)
    since = this_hour - timedelta(hours=hours - 1)
    async with d.db.tenant() as conn:
        folded = await conn.fetch(
            "SELECT * FROM bot_counts_hour WHERE hour >= $1 ORDER BY hour", since
        )
        games = await conn.fetch(
            "SELECT application_id, name, player_minutes FROM bot_activity_hour WHERE hour >= $1",
            since,
        )
        minutes = await conn.fetch(
            "SELECT * FROM bot_counts_minute WHERE minute >= $1 ORDER BY minute", since
        )
    series: dict[Any, dict[str, Any]] = {
        r["hour"]: {
            "hour": iso(r["hour"]),
            **{k: _number(r[k]) for k in SERIES},
            "messages": r["messages"],
        }
        for r in folded
    }
    rows = [(r["application_id"], r["name"], r["player_minutes"]) for r in games]
    by_hour: dict[Any, list[Any]] = {}
    for row in minutes:
        hour = row["minute"].replace(minute=0, second=0, microsecond=0)
        if hour not in series:
            by_hour.setdefault(hour, []).append(minute_of_row(row))
    for hour, found in by_hour.items():
        h: Hour = fold_hour(hour, found)
        series[hour] = {
            "hour": iso(hour),
            **{k: _number(getattr(h, k)) for k in SERIES},
            "messages": h.messages,
        }
        rows += [(app, name, n) for app, name, n in h.activities.values()]
    as_of = None
    if minutes:
        as_of = iso(minutes[-1]["minute"] + timedelta(minutes=1))
    elif folded:
        as_of = iso(folded[-1]["hour"] + timedelta(hours=1))
    body = {
        "hours": [series[k] for k in sorted(series)],
        "top_games": top_games(rows),
        "as_of": as_of,
    }
    return JSONResponse(body)


ROUTES = [Route("/api/bot/stats", get_stats, methods=["GET"])]
