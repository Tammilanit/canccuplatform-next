"""The run-of-show page and an item's page: one column for a phone, the day's items in order with
now, delays and cancellations, and the actions an organiser takes on the floor."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import model, store, undo
from .access import WRITE, viewer
from .deps import deps
from .effective import read_channels
from .history import changes_html
from .kinds import not_found
from .web import (
    BASE,
    CHANNEL_LABELS,
    VISIBILITY_LABELS,
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
    raw = request.query_params.get("day")
    if raw:
        try:
            return date.fromisoformat(raw)
        except ValueError:
            pass
    if today in days or not days:
        return today
    return next((d for d in days if d > today), days[-1])


def state_of(row: Any, now: datetime) -> str:
    if row["status"] == "cancelled":
        return "cancelled"
    if row["starts_at"] <= now and row["ends_at"] is not None and now < row["ends_at"]:
        return "running"
    if row["starts_at"] <= now:
        return "over"
    return "ahead"


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
    return "".join(
        f'<span class="canccu-agenda-chip canccu-agenda-chip--{k}">{esc(t)}</span>' for k, t in out
    )


def row_html(
    row: Any, item: dict[str, Any], kinds: dict[str, str], now: datetime, tz: ZoneInfo
) -> str:
    state = state_of(row, now)
    planned = ""
    if item["delay_minutes"]:
        planned = f' <s class="canccu-agenda-muted">{hhmm(row["planned_starts_at"], tz)}</s>'
    meta = [kinds.get(row["kind"], row["kind"])]
    meta += [v for v in (row["location"], row["zone"] and f"zone {row['zone']}") if v]
    if row["ends_at"] is not None:
        meta.append(f"until {hhmm(row['ends_at'], tz)}")
    return (
        f'<li><a class="canccu-agenda-row canccu-agenda-row--{state}"'
        f' href="{BASE}/items/{esc(row["id"])}">'
        f'<span class="canccu-agenda-row__time">{hhmm(row["starts_at"], tz)}{planned}</span>'
        f'<span class="canccu-agenda-row__title">{esc(row["title"])}</span>'
        f'<span class="canccu-agenda-row__meta">{esc(" · ".join(meta))}</span>'
        f'<span class="canccu-agenda-chips">{chips(row, item, now, tz)}</span></a></li>'
    )


async def run_of_show(request: Request) -> Response:
    session = await page_session(request)
    d = deps(request)
    tz, now = zone_of(request), d.now()
    seen = await viewer(request, session)
    channels = await read_channels(d)
    async with d.db.tenant() as conn:
        rows = await store.items(conn, seen.visibilities)
        kind_rows = await store.kinds(conn)
    items = [model.item_json(r, kind_rows, channels) for r in rows]
    kinds = {k: str(r["name"]) for k, r in kind_rows.items()}
    today = now.astimezone(tz).date()
    days = sorted({r["starts_at"].astimezone(tz).date() for r in rows})
    day = _day(request, days, today)
    tabs = "".join(
        f'<a class="canccu-agenda-tab" href="{BASE}/?day={d.isoformat()}"'
        f"{' aria-current=page' if d == day else ''}>"
        f"{'Today' if d == today else day_label(d)}</a>"
        for d in sorted({*days, today})
    )
    lines = []
    now_shown = day != today
    for row, item in zip(rows, items, strict=True):
        if row["starts_at"].astimezone(tz).date() != day:
            continue
        if not now_shown and row["starts_at"] > now:
            lines.append(f'<li class="canccu-agenda-nowline">Now {hhmm(now, tz)}</li>')
            now_shown = True
        lines.append(row_html(row, item, kinds, now, tz))
    if not now_shown:
        lines.append(f'<li class="canccu-agenda-nowline">Now {hhmm(now, tz)}</li>')
    done = DONE.get(request.query_params.get("done", ""))
    body = (
        (notice(done) if done else "")
        + await undo.offer_html(d, session, request.query_params.get("undo"))
        + f'<nav class="canccu-agenda-tabs" aria-label="Days">{tabs}</nav>'
        + f'<ol class="canccu-agenda-list">{"".join(lines)}</ol>'
    )
    if not any(r["starts_at"].astimezone(tz).date() == day for r in rows):
        body += "<p>Nothing on this day yet.</p>"
    if session.has(WRITE):
        body += (
            '<div class="canccu-agenda-bar">'
            f'<a class="canccu-button canccu-button--primary" href="{BASE}/add?day={day}">'
            "Quick add</a>"
            f'<a class="canccu-button canccu-button--secondary" href="{BASE}/items/new?day={day}">'
            "Full form</a></div>"
        )
    return page(request, "Run of show", body, session=session)


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
    body += '<dl class="canccu-agenda-facts">'
    body += "".join(f"<dt>{esc(k)}</dt><dd>{esc(v)}</dd>" for k, v in facts) + "</dl>"
    if row["managed_by"] is not None:
        body += "<p>Its title and times come from the tournament module.</p>"
    if session.has(WRITE) and state != "cancelled":
        base = f"{BASE}/items/{esc(row['id'])}"
        actions = []
        if state == "ahead" or (state == "running" and row["ends_at"] is not None):
            actions.append(("delay", "Delay…", "primary"))
        if state == "ahead" or (state == "running" and row["kind"] != "quiet_hours"):
            # A running item is on screens already; its page still sends the announcement.
            actions.append(("show-now", "Show on screens now", "secondary"))
        actions.append(("edit", "Edit or move", "secondary"))
        if row["managed_by"] is None:
            actions.append(("cancel", "Cancel…", "danger"))
        body += (
            '<div class="canccu-agenda-actions">'
            + "".join(
                f'<a class="canccu-button canccu-button--{k}" href="{base}/{p}">{esc(t)}</a>'
                for p, t, k in actions
            )
            + "</div>"
        )
    body += changes_html(log, tz, now.astimezone(tz).date())
    return page(request, row["title"], body, session=session)


ROUTES = [
    Route("/", run_of_show, methods=["GET"]),
    Route("/items/{item_id}", item_page, methods=["GET"]),
]
