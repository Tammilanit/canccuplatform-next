"""`/internal/bot/presence/playing` and `/voice` (contracts/bot.md, Who plays what: For the
screens): the live state as counts, for the screen module's `now_playing` and `voice_rooms`. Any
container answers: the live state is read back from Valkey, where the client's holder writes it
behind every few seconds (live.py).

Counts only, never who (D9 of docs/plans/issue-122.md: no names until #122's link 2b): no user
id, name or Discord id leaves here, and everyone `hidden_discord_ids` names is counted nowhere,
from the next read."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from typing import Any

from canccu_kit import KitError, ServiceForbidden, TenantResolver, tenant_scope
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import store
from .access import deps
from .catalogue import is_hidden, match
from .counts import iso
from .deps import Deps
from .live import AS_OF, GuildLive, live_key

SERVING = ("ready", "rate_limited")
"""A client's statuses in which its gateway still follows the guild: a rate limit holds REST
calls back, not the gateway's events."""


async def _event(request: Request) -> dict[str, Any]:
    caller = request.state.service
    if caller != "screen":
        raise ServiceForbidden(f"module {caller} may not read the screens' presence counts")
    resolver: TenantResolver = request.app.state.tenants
    # by_id answers None for an id that is not one, before any request.
    ctx = await resolver.by_id(request.query_params.get("tenant_id", ""))
    if ctx is None:
        raise KitError("no such event", status=404, code="not_found")
    return dict(ctx)


async def _live(d: Deps, ctx: dict[str, Any], flag: str) -> tuple[GuildLive, str] | None:
    """The event's live state and its `as_of`, or None while the answer is not available: no
    guild bound, the client not serving, the feed's flag off or the event archived."""
    tenant = ctx["tenant_id"]
    if ctx["status"] == "archived" or not ctx["flags"].get(flag, False):
        return None
    with tenant_scope(tenant):
        async with d.db.tenant(tenant) as conn:
            bound = await store.binding(conn)
            row = await store.connection(conn)
    if bound is None:
        return None
    own = row is not None and row["mode"] == "own"
    application_id = row["application_id"] if own else bound["application_id"]
    seen = await d.board.read(application_id)
    as_of = await d.keys.get(live_key(tenant, AS_OF))
    if seen is None or seen["status"] not in SERVING or as_of is None:
        return None
    live = GuildLive(tenant)
    await live.load(d.keys)
    return live, iso(datetime.fromisoformat(as_of))


def _players(live: GuildLive, hidden: frozenset[str], games: list[dict[str, Any]]) -> Counter[Any]:
    """Players per game id, `None` for the activities that match no game: each person once per
    game, however many of their activities match it; a hidden game's activities nowhere."""
    out: Counter[Any] = Counter()
    left_out = hidden | live.presence.bots()
    for uid, raw in live.activities.playing.values.items():
        if uid in left_out:
            continue
        played = set()
        for app, name in json.loads(raw):
            if is_hidden(name, app, games):
                continue
            game = match(name, app, games)
            played.add(None if game is None else game["id"])
        out.update(played)
    return out


async def playing(request: Request) -> Response:
    d = deps(request)
    ctx = await _event(request)
    found = await _live(d, ctx, "bot.presence")
    if found is None:
        return JSONResponse({"available": False, "as_of": None, "games": []})
    live, as_of = found
    tenant = ctx["tenant_id"]
    games = await d.catalogue(tenant)
    names = {g["id"]: str(g["name"]) for g in games}
    counted = _players(live, await d.hidden(tenant), games)
    listed = [
        {"game_id": gid, "name": None if gid is None else names[gid], "player_count": n}
        for gid, n in counted.items()
    ]
    # Most players first; among equals the unmatched entry last, then by name.
    listed.sort(key=lambda g: (-g["player_count"], g["game_id"] is None, g["name"] or ""))
    return JSONResponse({"available": True, "as_of": as_of, "games": listed})


async def voice(request: Request) -> Response:
    d = deps(request)
    ctx = await _event(request)
    found = await _live(d, ctx, "bot.voice")
    if found is None:
        return JSONResponse({"available": False, "as_of": None, "channels": []})
    live, as_of = found
    hidden = await d.hidden(ctx["tenant_id"])
    _, rooms = live.voice.count(hidden, live.presence.bots(), live.channels.voice_rooms())
    return JSONResponse({"available": True, "as_of": as_of, "channels": rooms})


ROUTES = [
    Route("/internal/bot/presence/playing", playing, methods=["GET"]),
    Route("/internal/bot/presence/voice", voice, methods=["GET"]),
]
