"""The Discord page's routes (#765; U10 of the step 6 plan): the guided setup while no server is
bound, then the Overview, Channels, Commands and Check tabs. Each reads what the contract's own
reads read, in this process; each change is the contract's API, sent by discord.js (page_web)."""

from __future__ import annotations

import json
from typing import Any

from canccu_kit import KitError, ui
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import commands, connection, page_channels, page_commands, page_setup, setup_check
from . import server as live
from .access import deps
from .deps import Deps
from .guild import ended_key
from .page_overview import Overview, cards, edge, history, unbind_form
from .page_web import View, answer_notice, render, steps_bar, to_start, view_of
from .purposes import stored, views

SETUP_ABOUT = "Connect your event's Discord server. About five minutes."


async def _connection(d: Deps) -> tuple[dict[str, Any] | None, bool]:
    """The `Connection`, or None with True when the platform has no shared bot and the event
    no own application yet (503 `discord_not_configured` in the API)."""
    try:
        async with d.db.tenant() as conn:
            return await connection.view(d, conn), False
    except KitError as exc:
        if exc.code != "discord_not_configured":
            raise
        return None, True


async def _ended(d: Deps, tenant: str) -> dict[str, Any] | None:
    raw = await d.keys.get(ended_key(tenant))
    return json.loads(raw) if raw else None


def _counts(d: Deps, view: View) -> tuple[int, int]:
    """(slash commands, message menus) the server has for the event's flags now."""
    wanted = commands.wanted(d, view.ctx)
    menus = sum(1 for c in wanted if c.get("type") == 3)
    return len(wanted) - menus, menus


def _about(conn: dict[str, Any] | None) -> str:
    guild = conn["guild"] if conn else None
    return f"{guild['guild_name']} · bound" if guild else SETUP_ABOUT


async def start(request: Request) -> Response:
    """The page's start: the setup while no server is bound (or Discord's install page just sent
    the person back), the Overview once one is."""
    view = await view_of(request)
    d = deps(request)
    conn, no_shared = await _connection(d)
    outcome = request.query_params.get("bind")
    ended = await _ended(d, view.ctx["tenant_id"])
    if conn is None or conn["guild"] is None or outcome is not None:
        stub = None
        if conn is not None:
            stub = Overview(conn, None, None, (0, 0), ended, d.now())
        lead = (
            answer_notice(request)
            + page_setup.bind_result(outcome, conn)
            + edge(view, stub, conn)
            + steps_bar(1 if outcome is None else 2)
        )
        body = page_setup.body(view, conn, no_shared, lead)
        return render(request, view, body, description=SETUP_ABOUT)
    tenant = view.ctx["tenant_id"]
    async with d.db.tenant() as db:
        counted = await db.fetchrow(
            "SELECT minute, online FROM bot_counts_minute ORDER BY minute DESC LIMIT 1"
        )
    kept = await d.keys.get(setup_check.key(tenant, conn["guild"]["guild_id"]))
    o = Overview(
        conn, counted, json.loads(kept) if kept else None, _counts(d, view), ended, d.now()
    )
    body = answer_notice(request) + edge(view, o, conn) + cards(view, o) + history(view, o)
    body += unbind_form(view, conn)
    return render(request, view, body, description=_about(conn), tab="/")


async def setup(request: Request) -> Response:
    """Steps 1 and 2, also once bound: a new token after Discord refused the old one."""
    view = await view_of(request)
    conn, no_shared = await _connection(deps(request))
    lead = answer_notice(request) + steps_bar(1)
    body = page_setup.body(view, conn, no_shared, lead)
    return render(request, view, body, description=SETUP_ABOUT)


async def _server(request: Request, view: View) -> tuple[live.Server | None, str]:
    """The bound server read live, or None with the notice why it can't be."""
    try:
        return await live.read(deps(request), view.ctx), ""
    except KitError as exc:
        if exc.code != "discord_unavailable":
            raise
        return None, _discord_down()


async def _tab(request: Request) -> tuple[View, dict[str, Any], bool] | Response:
    view = await view_of(request)
    conn, _ = await _connection(deps(request))
    if conn is None or conn["guild"] is None or view.archived:
        return to_start()  # nothing to read: an archived event's server is read no more
    return view, conn, request.query_params.get("setup") == "1"


def _framed(
    request: Request, view: View, conn: dict[str, Any], tab: str, step: int, setup: bool, body: str
) -> Response:
    lead = answer_notice(request)
    if setup:
        return render(request, view, lead + steps_bar(step) + body, description=_about(conn))
    return render(request, view, lead + body, description=_about(conn), tab=tab)


async def channels_tab(request: Request) -> Response:
    found = await _tab(request)
    if isinstance(found, Response):
        return found
    view, conn, setup_mode = found
    server, trouble = await _server(request, view)
    body = trouble
    if server is not None:
        purposes = views(view.ctx, server, await stored(deps(request), view.ctx["tenant_id"]))
        body = page_channels.channels(view, purposes, server, setup_mode)
    return _framed(request, view, conn, "/channels", 3, setup_mode, body)


async def check_tab(request: Request) -> Response:
    found = await _tab(request)
    if isinstance(found, Response):
        return found
    view, conn, setup_mode = found
    d = deps(request)
    server, trouble = await _server(request, view)
    body = trouble
    if server is not None:
        kept = await d.keys.get(setup_check.key(view.ctx["tenant_id"], server.guild_id))
        try:
            result = json.loads(kept) if kept else await setup_check.run(d, view.ctx, server)
            body = page_channels.check(view, result, setup_mode)
        except KitError as exc:
            if exc.code != "discord_unavailable":
                raise
            body = _discord_down()
    return _framed(request, view, conn, "/check", 4, setup_mode, body)


def _discord_down() -> str:
    text = "The tab shows it once Discord answers again. Try again in a moment."
    return ui.notice("down", "Discord did not answer", text)


async def commands_tab(request: Request) -> Response:
    found = await _tab(request)
    if isinstance(found, Response):
        return found
    view, conn, _ = found
    d = deps(request)
    body = page_commands.body(view, conn["guild"], d.commands, _counts(d, view))
    return _framed(request, view, conn, "/commands", 0, False, body)


ROUTES = [
    Route("/", start, methods=["GET"]),
    Route("/setup", setup, methods=["GET"]),
    Route("/channels", channels_tab, methods=["GET"]),
    Route("/check", check_tab, methods=["GET"]),
    Route("/commands", commands_tab, methods=["GET"]),
]
