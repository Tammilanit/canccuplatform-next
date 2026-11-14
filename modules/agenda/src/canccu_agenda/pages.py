"""The run-of-show page and an item's page: the day view (day_view.py) with now, delays and
cancellations, and the actions an organiser takes on the floor."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from canccu_kit.ui import empty_state, icon
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import day_list, day_view, delay_pages, edit_pages, model, posts, store, undo
from .access import WRITE, viewer
from .day_view import can_delay, can_show, state_of
from .deps import deps
from .effective import read_channels
from .event_dates import event_over, event_span
from .history import changes_html
from .kinds import not_found
from .web import (
    ARCHIVED_ITEM,
    BASE,
    CHANNEL_LABELS,
    SCRIPT_TAGS,
    VISIBILITY_LABELS,
    archived,
    day_label,
    esc,
    hhmm,
    notice,
    page,
    page_session,
    zone_of,
)

# Fixed texts for the notice after a change: a query parameter never puts its own words on a page.
DONE = {
    "added": "Added.",
    "added_next_day": "Added to the next day: its time is after midnight.",
    "brought_back": "Brought back.",
    "saved": "Saved.",
    "delayed": "Delayed.",
    "cancelled": "Cancelled.",
    "shown": "Brought forward: screens show it now.",
    "shown_announced": "Brought forward and announced: screens show it now.",
    "announced": "Announced.",
    "shown_not_announced": (
        "Brought forward, but not announced: open it to try the announcement again."
    ),
    "undone": "Undone. People who were told are told again.",
}


def _day(request: Request, days: list[date], today: date) -> date:
    """The day the switch marks first: the one a change came back to (`day`), else today."""
    try:
        wanted = date.fromisoformat(request.query_params.get("day", ""))
    except ValueError:
        return today
    return wanted if wanted in days else today


def chips(row: Any, item: dict[str, Any], now: datetime, tz: ZoneInfo) -> str:
    out = []
    state = state_of(row, now)
    labels = {"cancelled": "Cancelled", "running": "Now", "over": "Done"}
    if state in labels:
        out.append((state, labels[state]))
    if state != "cancelled" and item["delay_minutes"]:
        out.append(("delayed", f"{item['delay_minutes']:+d} min"))
    if row["ends_at"] is not None and row["ends_at"] != row["planned_ends_at"]:
        out.append(("delayed", f"until {hhmm(row['ends_at'], tz)}"))
    if row["managed_by"] is not None:
        out.append(("managed", "Tournament"))
    if row["visibility"] != "public":
        out.append(("audience", VISIBILITY_LABELS[row["visibility"]]))
    # A badge says it in a word; a delay is the one solid badge (design README, Decisions 3).
    badge = {"running": "primary", "cancelled": "down", "delayed": "late"}
    return "".join(
        f'<span class="canccu-badge canccu-badge--{badge.get(k, "plain")}">{esc(t)}</span>'
        for k, t in out
    )


async def run_of_show(request: Request) -> Response:
    session = await page_session(request)
    d = deps(request)
    tz, now = zone_of(request), d.now()
    seen = await viewer(request, session)
    channels = await read_channels(d)
    view = day_list.view_of(request, seen.visibilities)
    async with d.db.tenant() as conn:
        rows = await store.items(conn, seen.visibilities)
        kind_rows = await store.kinds(conn)
        side = day_view.picked(rows, view.item, now)
        log = await store.changes(conn, side["id"]) if side is not None else []
        post = await posts.last(conn, tz)
    kinds = {k: str(r["name"]) for k, r in kind_rows.items()}
    today = now.astimezone(tz).date()
    writes = session.has(WRITE)
    done = DONE.get(request.query_params.get("done", ""))
    body = (notice(done) if done else "") + await undo.offer_html(
        d, session, request.query_params.get("undo")
    )
    # This view's own address, where a delay sheet's Close and Don't delay lead back to.
    here = view.href()
    listed, days = day_list.build(
        rows,
        kinds,
        now,
        tz,
        view,
        None if side is None else side["id"],
        writes,
        event_span(request),
    )
    # Today's line carries the now line; outside the event there is neither, nor a way to them.
    now_line = today in days
    hero = day_view.on_now(rows, now, tz)
    if hero is not None:
        body += day_list.strip_html(hero, now, tz, now_line)
        body += day_view.hero_html(hero, now, tz, session, here, post)
    if rows:
        filters = day_list.filter_html(view, seen.visibilities)
        body += day_list.days_html(days, _day(request, days, today), filters, now_line)
        aside = ""
        if side is not None:
            item = model.item_json(side, kind_rows, channels)
            picked_here = view.item == side["id"]
            close = view.href(item=None) + f"#r-{side['id']}" if picked_here else None
            history = changes_html(log, tz, today)
            back = _bring_back(request, side, session, now)
            why = _read_only(request)
            aside = day_view.side_html(
                side, item, kinds, now, tz, session, close, history, here, back, why
            )
        body += f'<div class="canccu-agenda-day">{listed}{aside}</div>'
    else:
        add = (
            f'<a class="canccu-button canccu-button--primary" href="{BASE}/add">'
            f"{icon('plus')}Add the first item</a>"
            if writes
            else ""
        )
        text = "Add the first item, or start from a template." if writes else "Check back later."
        body += (
            '<section class="canccu-card">'
            + empty_state("calendar", "Nothing in the run of show yet", text, add)
            + "</section>"
        )
    body += await _delay_sheet(request, rows, now, here) if writes else ""
    # The day switch follows the scroll and a phone keeps what is on now in view; for a writer
    # a long press shows a gap's line. The page works without it.
    body += SCRIPT_TAGS["day.js"]
    actions = (
        f'<a class="canccu-button canccu-button--secondary" href="{BASE}/items/new">'
        "Full form</a>"
        f'<a class="canccu-button canccu-button--primary" href="{BASE}/add">'
        f"{icon('plus')}Quick add</a>"
        if writes
        else ""
    )
    on_today = sum(1 for r in rows if r["starts_at"].astimezone(tz).date() == today)
    count = f"{on_today} item{'' if on_today == 1 else 's'} today, {len(rows)} in all"
    about = f"{today:%A} {today.day} {today:%B} · {count} · times in {tz}"
    return page(
        request,
        "Run of show",
        body,
        session=session,
        actions=actions,
        description=about,
        narrow=False,
    )


def _read_only(request: Request) -> str:
    return f'<p class="canccu-agenda-muted">{ARCHIVED_ITEM}</p>' if archived(request) else ""


def _bring_back(request: Request, row: Any, session: Any, now: datetime) -> str:
    """A cancelled item comes back until the event ends (sheet 5); a session's item comes back
    in the tournament module."""
    if not session.has(WRITE) or row["status"] != "cancelled" or row["managed_by"] is not None:
        return ""
    return "" if event_over(request, now) else edit_pages.bring_back_form(row)


async def _delay_sheet(request: Request, rows: list[Any], now: datetime, here: str) -> str:
    """The delay confirm a chip asked for (`delay` and `minutes`), over the day; none for an item
    this session does not see or that can no longer be delayed."""
    wanted = request.query_params.get("delay")
    row = next((r for r in rows if r["id"] == wanted), None) if wanted else None
    if row is None or not can_delay(row, state_of(row, now)):
        return ""
    return await delay_pages.sheet(request, row, request.query_params.get("minutes", ""), here)


async def item_page(request: Request) -> Response:
    session = await page_session(request)
    d = deps(request)
    tz, now = zone_of(request), d.now()
    seen = await viewer(request, session)
    channels = await read_channels(d)
    async with d.db.tenant() as conn:
        row = await store.item(conn, request.path_params["item_id"])
        # Like the API: an item the session may not see does not exist for it.
        if row is None or row["visibility"] not in seen.visibilities:
            raise not_found("item")
        item = model.item_json(row, await store.kinds(conn), channels)
        log = await store.changes(conn, row["id"])
    state = state_of(row, now)
    when = f"{day_label(row['starts_at'].astimezone(tz).date())} {hhmm(row['starts_at'], tz)}"
    if row["ends_at"] is not None:
        when += f" to {hhmm(row['ends_at'], tz)}"
    if item["delay_minutes"]:
        when += f" (planned {hhmm(row['planned_starts_at'], tz)})"
    facts = [
        ("When", when),
        (
            "Where",
            " · ".join(v for v in (row["location"], row["zone"] and f"zone {row['zone']}") if v)
            or "—",
        ),
        ("Who sees it", VISIBILITY_LABELS[row["visibility"]]),
        ("Channels", ", ".join(CHANNEL_LABELS[c] for c in item["notify_channels"]) or "none"),
    ]
    if row["description"]:
        facts.append(("About", row["description"]))
    body = f'<p class="canccu-agenda-chips">{chips(row, item, now, tz)}</p>'
    body += '<section class="canccu-card"><dl class="canccu-dl">'
    body += "".join(f"<dt>{esc(k)}</dt><dd>{esc(v)}</dd>" for k, v in facts) + "</dl></section>"
    if row["managed_by"] is not None:
        body += "<p>Its title and times come from the tournament module.</p>"
    if session.has(WRITE) and state != "cancelled":
        base = f"{BASE}/items/{esc(row['id'])}"
        actions = []
        if can_delay(row, state):
            actions.append(("delay", "Delay…", "primary"))
        if can_show(row, state):
            actions.append(("show-now", "Show on screens now", "secondary"))
        actions.append(("edit", "Edit or move", "secondary"))
        if row["managed_by"] is None:
            actions.append(("cancel", "Cancel…", "danger-ghost"))
        body += (
            '<div class="canccu-agenda-actions">'
            + "".join(
                f'<a class="canccu-button canccu-button--{k}" href="{base}/{p}">{esc(t)}</a>'
                for p, t, k in actions
            )
            + "</div>"
        )
    body += changes_html(log, tz, now.astimezone(tz).date())
    body += _bring_back(request, row, session, now) + _read_only(request)
    return page(request, row["title"], body, session=session)


ROUTES = [
    Route("/", run_of_show, methods=["GET"]),
    Route("/items/{item_id}", item_page, methods=["GET"]),
]
