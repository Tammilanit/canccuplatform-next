"""The run of show's day view (docs/design/mockups.html, sheet 5): what is on now, the day as one
list, and one item beside it. No script: a row picks its item, and a delay chip opens its confirm
(delay_pages.sheet), through the query; agenda.css puts the item beside the list from 1440 px and
over the day below that."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from canccu_kit.rights import Session
from canccu_kit.ui import icon

from .access import WRITE
from .web import BASE, CHANNEL_LABELS, VISIBILITY_LABELS, esc, hhmm

# Screen's own player of a zone for a signed-in person (contracts/screen.md, A zone for a
# session), so the miniature is the live Pulse with this list's delays. Every event has `main`.
SCREEN_READ = "screen.devices.read"
MAIN_ZONE = "/screen/zones/main"
DELAY_CHIPS = (5, 10, 15)
# Until this hour an item belongs to the night before (sheet 5: "00:15 Sun").
NIGHT_ENDS = 6
FOR = {"public": "everyone", "attendees": "attendees", "crew": "crew"}


def state_of(row: Any, now: datetime) -> str:
    if row["status"] == "cancelled":
        return "cancelled"
    if row["starts_at"] <= now and row["ends_at"] is not None and now < row["ends_at"]:
        return "running"
    if row["starts_at"] <= now:
        return "over"
    return "ahead"


def can_delay(row: Any, state: str) -> bool:
    # A moment that has started has no end to move.
    return state == "ahead" or (state == "running" and row["ends_at"] is not None)


def can_show(row: Any, state: str) -> bool:
    # A running item is on screens already; its page still sends the announcement.
    return state == "ahead" or (state == "running" and row["kind"] != "quiet_hours")


def _minutes(delta: Any) -> int:
    return int(delta.total_seconds() // 60)


def _slip(row: Any) -> int:
    """How far the item slipped: its start, or once it has started only its end moves."""
    if row["starts_at"] != row["planned_starts_at"]:
        return _minutes(row["starts_at"] - row["planned_starts_at"])
    if row["ends_at"] is not None and row["planned_ends_at"] is not None:
        return _minutes(row["ends_at"] - row["planned_ends_at"])
    return 0


def _late(minutes: int) -> str:
    if not minutes:
        return ""
    return f'<span class="canccu-badge canccu-badge--late">{minutes:+d} min</span>'


def late_badge(row: Any) -> str:
    return _late(_slip(row))


def span(minutes: int) -> str:
    hours, rest = divmod(minutes, 60)
    if not hours:
        return f"{rest} min"
    return f"{hours} h {rest} min" if rest else f"{hours} h"


def _where(row: Any) -> str:
    return " · ".join(v for v in (row["location"], row["zone"] and f"zone {row['zone']}") if v)


def _delay(row: Any, here: str, grid: bool = False) -> str:
    """The delay chips. A chip opens the confirm as a sheet over this view (`here`, the day view's
    own address); Other… goes to the delay page, which has the field for any minutes."""
    sheet = f"{here}{'&' if '?' in here else '?'}delay={row['id']}&minutes="
    links = "".join(
        f'<a class="canccu-button canccu-button--secondary" href="{esc(sheet)}{m}">+{m}</a>'
        for m in DELAY_CHIPS
    )
    return (
        f'<div class="canccu-agenda-delay{" canccu-agenda-delay--grid" if grid else ""}">'
        f'<span class="canccu-agenda-muted">Delay by</span>{links}'
        f'<a class="canccu-button canccu-button--secondary"'
        f' href="{BASE}/items/{esc(row["id"])}/delay">Other…</a></div>'
    )


def _show(row: Any, label: str = "Show on screens now") -> str:
    return (
        f'<a class="canccu-button canccu-button--secondary"'
        f' href="{BASE}/items/{esc(row["id"])}/show-now">{icon("monitor")}{label}</a>'
    )


def on_now(rows: list[Any], now: datetime, tz: ZoneInfo) -> Any | None:
    """The item the now card shows: the one that started last of those running, or else the next
    one today. Quiet hours run beside the programme, so they never take the card."""
    live = [r for r in rows if r["kind"] != "quiet_hours" and r["status"] != "cancelled"]
    running = [r for r in live if state_of(r, now) == "running"]
    if running:
        return max(running, key=lambda r: r["starts_at"])
    today = now.astimezone(tz).date()
    return next(
        (
            r
            for r in live
            if state_of(r, now) == "ahead" and r["starts_at"].astimezone(tz).date() == today
        ),
        None,
    )


def hero_html(
    row: Any,
    now: datetime,
    tz: ZoneInfo,
    session: Session,
    here: str,
    post: tuple[str, str] | None = None,
) -> str:
    """What is on now (or next) with its actions, and beside it from 1440 px what the main zone's
    screens show, with the run of show's last Discord post under it (posts.py)."""
    state = state_of(row, now)
    if state == "running":
        left = _minutes(row["ends_at"] - now)
        kicker = f"On now · {span(left)} left"
        when = f"until {hhmm(row['ends_at'], tz)}"
        if row["ends_at"] != row["planned_ends_at"] and row["planned_ends_at"] is not None:
            when += f" <s>{hhmm(row['planned_ends_at'], tz)}</s>"
    else:
        kicker = f"Up next · in {span(_minutes(row['starts_at'] - now))}"
        when = hhmm(row["starts_at"], tz)
        if row["starts_at"] != row["planned_starts_at"]:
            when += f" <s>{hhmm(row['planned_starts_at'], tz)}</s>"
    where = _where(row)
    line = f"{esc(where)} · {when}" if where else when
    actions = ""
    if session.has(WRITE):
        parts = [_delay(row, here)] if can_delay(row, state) else []
        parts += [_show(row)] if can_show(row, state) else []
        actions = f'<div class="canccu-agenda-hero__actions">{"".join(parts)}</div>'
    screen = ""
    if session.has(SCREEN_READ):
        # Lazy: below 1440 px the miniature is hidden, and a hidden lazy frame never loads.
        screen = (
            '<div class="canccu-agenda-hero__screen">'
            '<p class="canccu-overline">What people see · main zone, live</p>'
            f'<div class="canccu-agenda-mini"><iframe src="{MAIN_ZONE}" loading="lazy"'
            ' tabindex="-1" title="The main zone\'s screens, live"></iframe></div>'
            + (
                f'<p class="canccu-agenda-post">Discord, {post[0]}: “{esc(post[1])}”</p>'
                if post
                else ""
            )
            + "</div>"
        )
    return (
        '<section class="canccu-agenda-hero"><div>'
        f'<p class="canccu-agenda-kicker">{kicker}</p>'
        f'<h2 class="canccu-agenda-hero__title">{esc(row["title"])}</h2>'
        f'<p class="canccu-agenda-hero__line">{line} {_late(_slip(row))}</p>'
        f"{actions}</div>{screen}</section>"
    )


def row_html(
    row: Any, kinds: dict[str, str], now: datetime, tz: ZoneInfo, href: str, selected: bool
) -> str:
    """One item's row, which picks it (`href`). An item before NIGHT_ENDS belongs to the night
    before, so its time says its day ("00:15 Sun")."""
    state = state_of(row, now)
    local = row["starts_at"].astimezone(tz)
    night = f"<small>{local:%a}</small>" if local.hour < NIGHT_ENDS else ""
    was = ""
    if row["starts_at"] != row["planned_starts_at"]:
        was = f'<s class="canccu-agenda-was">{hhmm(row["planned_starts_at"], tz)}</s>'
    badges = ""
    if state == "running":
        badges += '<span class="canccu-badge canccu-badge--primary">Now</span>'
    if state == "cancelled":
        badges += '<span class="canccu-badge canccu-badge--down">Cancelled</span>'
    else:
        badges += _late(_slip(row))
    if row["visibility"] == "crew":
        badges += f'<span class="canccu-badge">{VISIBILITY_LABELS["crew"]}</span>'
    kind = kinds.get(row["kind"], row["kind"])
    where = _where(row)
    pick = " is-selected" if selected else ""
    return (
        f'<li id="r-{esc(row["id"])}"><a class="canccu-agenda-row canccu-agenda-row--{state}{pick}"'
        f' href="{esc(href)}">'
        f'<span class="canccu-agenda-row__time">{hhmm(row["starts_at"], tz)}{night}</span>'
        f'<span class="canccu-agenda-row__was">{was}</span>'
        f'<span class="canccu-agenda-row__what"><span class="canccu-agenda-row__title">'
        f'{esc(row["title"])}</span><span class="canccu-agenda-row__kind">{esc(kind)}</span>'
        f"{badges}</span>"
        f'<span class="canccu-agenda-row__where">{esc(where)}</span>'
        f'<span class="canccu-agenda-row__for">{FOR[row["visibility"]]}</span>'
        f'<span class="canccu-agenda-row__meta">{esc(" · ".join(v for v in (where, kind) if v))}'
        f"</span>{icon('right')}</a></li>"
    )


def gap_html(before: Any, after: Any, tz: ZoneInfo, day: date) -> str:
    """The line between two items (sheet 5, "Adding an item where it goes"): it names both by
    their starts, and Quick add opens at the end of the first with the room left before the next.
    A moment has no end, so the room starts at its start; items that overlap leave no room, and
    then the template's length stands."""
    start = before["ends_at"] if before["ends_at"] is not None else before["starts_at"]
    start = min(start, after["starts_at"])
    room = _minutes(after["starts_at"] - start)
    href = f"{BASE}/add?day={day.isoformat()}&amp;at={hhmm(start, tz)}"
    href += f"&amp;minutes={room}" if room > 0 else ""
    names = f"{hhmm(before['starts_at'], tz)} and {hhmm(after['starts_at'], tz)}"
    return (
        f'<li class="canccu-agenda-gap"><a href="{href}">{icon("plus")}Add between {names}</a></li>'
    )


def add_row_html(day: date) -> str:
    return (
        f'<li class="canccu-agenda-addrow"><a href="{BASE}/add?day={day.isoformat()}">'
        f"{icon('plus')}Add item on {day:%A}</a></li>"
    )


def list_html(rows: list[str]) -> str:
    """The list under its header row, which stays at the top while the list scrolls."""
    head = "".join(f"<span>{c}</span>" for c in ("Time", "Was", "What", "Where", "For"))
    return (
        '<ol class="canccu-card canccu-card--flush canccu-agenda-list">'
        f'<li class="canccu-agenda-head" aria-hidden="true">{head}</li>{"".join(rows)}</ol>'
    )


def picked(rows: list[Any], wanted: str | None, now: datetime) -> Any | None:
    """The item beside the list: the one a row picked, or else the next one, which is the one an
    organiser most likely acts on, or else the one running."""
    if wanted:
        chosen = next((r for r in rows if r["id"] == wanted), None)
        if chosen is not None:
            return chosen
    live = [r for r in rows if r["status"] != "cancelled"]
    for state in ("ahead", "running"):
        found = next((r for r in live if state_of(r, now) == state), None)
        if found is not None:
            return found
    return None


def side_html(
    row: Any,
    item: dict[str, Any],
    kinds: dict[str, str],
    now: datetime,
    tz: ZoneInfo,
    session: Session,
    close: str | None,
    changes: str,
    here: str,
    bring_back: str = "",
    read_only: str = "",
) -> str:
    """The picked item with its actions. `close` is where Close goes when a row picked it; `here`
    is the day view's own address, which its delay chips return to; `bring_back` is a cancelled
    item's way back, when it has one; `read_only` says why an archived event's item has no
    actions."""
    state = state_of(row, now)
    base = f"{BASE}/items/{esc(row['id'])}"
    when = f"<b>{hhmm(row['starts_at'], tz)}"
    if row["ends_at"] is not None:
        when += f"&ndash;{hhmm(row['ends_at'], tz)}"
    when += "</b>"
    if row["starts_at"] != row["planned_starts_at"]:
        when += f' <s class="canccu-agenda-was">{hhmm(row["planned_starts_at"], tz)}</s>'
    channels = ", ".join(CHANNEL_LABELS[c] for c in item["notify_channels"]) or "none"
    facts = [("When", when), ("Where", esc(_where(row)) or "—"), ("Told on", esc(channels))]
    badges = "".join(
        f'<span class="canccu-badge">{esc(b)}</span>'
        for b in (kinds.get(row["kind"], row["kind"]), VISIBILITY_LABELS[row["visibility"]])
    )
    shut = (
        f'<a class="canccu-button canccu-button--ghost canccu-button--sm canccu-agenda-close"'
        f' href="{esc(close)}">{icon("close")}Close</a>'
        if close
        else ""
    )
    body = (
        f'{shut}<div><p class="canccu-overline">Selected</p>'
        f'<h2 class="canccu-card__title"><a href="{base}">{esc(row["title"])}</a></h2>'
        f'<div class="canccu-agenda-chips">{badges}</div></div>'
        '<dl class="canccu-dl">' + "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in facts) + "</dl>"
    )
    if session.has(WRITE) and state != "cancelled":
        if can_delay(row, state):
            body += _delay(row, here, grid=True)
        actions = [_show(row, "On screens now")] if can_show(row, state) else []
        actions.append(
            f'<a class="canccu-button canccu-button--secondary" href="{base}/edit">Edit or move</a>'
        )
        body += f'<div class="canccu-agenda-side__actions">{"".join(actions)}</div>'
    body += changes + bring_back + read_only
    if session.has(WRITE) and state != "cancelled" and row["managed_by"] is None:
        body += f'<a class="canccu-agenda-danger" href="{base}/cancel">Cancel this item…</a>'
    opened = " is-open" if close else ""
    return f'<aside class="canccu-card canccu-agenda-side{opened}">{body}</aside>'
