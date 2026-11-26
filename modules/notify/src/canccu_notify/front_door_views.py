"""What the event's front door says (#750): one card under the poster, with what is on now and
next, the public pages that are on, and the crew's way in. HTML only; front_door picks the state.
The hub (App track) grows from this page, so it speaks to attendees first and to the crew last."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from canccu_kit import ui

SECONDARY = "canccu-button canccu-button--secondary canccu-button--lg canccu-button--block"
PRIMARY = "canccu-button canccu-button--primary canccu-button--lg canccu-button--block"

# The attendees' pages that exist, each with the flag that switches its module off (#745: one
# `<module>.enabled` per module, on by default). The run of show, venue info and the tournament
# have no attendee page yet; each joins this list with its page.
PUBLIC_PAGES = (("pizza", "/pizza/", "food", "Food", "Group orders, and when the food is here"),)


def _state(ico: str, title: str, text: str) -> str:
    return (
        f'<span class="canccu-task__icon">{ui.icon(ico)}</span><h1>{ui.esc(title)}</h1>'
        f'<p class="canccu-muted">{ui.esc(text)}</p>'
    )


def whats_on() -> str:
    return "<h1>What's on</h1>"


def ended() -> str:
    text = "Thanks for coming. Its pages stay open to read."
    return _state("archive", "The event has ended", text)


def not_open() -> str:
    return _state(
        "clock",
        "Not open yet",
        "The organisers are still preparing this event. Its page opens when they publish it.",
    )


def draft_notice() -> str:
    return ui.notice("info", "Draft", "Only the organisers see this event until it opens.")


def closed(mode: str) -> str:
    """The info-page mode keeps this guest out (contracts/tenants.md, Info-page mode)."""
    if mode == "venue_only":
        return _state(
            "pin",
            "Open at the venue",
            "This event's page opens on the venue's Wi-Fi. Join it there, then open this page"
            " again.",
        )
    return _state("lock", "For members", "This event's page is open to its members only.")


def no_event() -> str:
    return _state(
        "compass", "No event here", "There's no event at this address. Check the link you got."
    )


def failed() -> str:
    again = f'<a class="{PRIMARY}" href="/">{ui.icon("refresh")}Try again</a>'
    return _state("alert", "Couldn't load the event", "Try again in a moment.") + again


def _when(item: dict[str, Any], zone: str, today: str) -> str:
    at = ui.time_label(item["starts_at"], zone)
    day = ui.day_label(item["starts_at"], zone)
    return at if day == today else f"{day} {at}"


def _row(label: str, item: dict[str, Any], detail: list[str]) -> str:
    late = item.get("delay_minutes") or 0
    badge = f' <span class="canccu-badge canccu-badge--late">+{late} min</span>' if late > 0 else ""
    line = " · ".join(d for d in detail if d)
    return (
        f'<div class="canccu-front-door__item"><p class="canccu-overline">{label}</p>'
        f"<p><b>{ui.esc(item.get('title'))}</b>{badge}</p>"
        + (f'<p class="canccu-muted">{ui.esc(line)}</p>' if line else "")
        + "</div>"
    )


def now_next(now: dict[str, Any] | None, zone: str, at: datetime) -> str:
    """What the run of show has on now and next (contracts/agenda.md, Reading), two of each at
    most, as a phone shows it at a glance. None: the agenda did not answer, so the part is left
    out rather than claim nothing is on."""
    if now is None:
        return ""
    today = ui.day_label(at, zone)
    rows = []
    for item in (now.get("current") or [])[:2]:
        until = f"until {ui.time_label(item['ends_at'], zone)}" if item.get("ends_at") else ""
        rows.append(_row("Now", item, [str(item.get("location") or ""), until]))
    for item in (now.get("next") or [])[:2]:
        rows.append(_row("Next", item, [_when(item, zone, today), str(item.get("location") or "")]))
    if not rows:
        return (
            '<p class="canccu-front-door__now canccu-muted">'
            "Nothing on the run of show right now.</p>"
        )
    return (
        '<section class="canccu-front-door__now" aria-label="Now and next">'
        + "".join(rows)
        + "</section>"
    )


# The kit's icons that stand for a Moments icon (contracts/moments.md, Levels); others read as info.
_ICONS = {
    "food": "food",
    "trophy": "flag",
    "clock": "clock",
    "door": "out",
    "search": "compass",
    "megaphone": "megaphone",
}


def _left(item: dict[str, Any], at: datetime) -> str:
    """The time left as words and a bar, from `sent_at` to `expires_at`; nothing when unknown."""
    try:
        sent = datetime.fromisoformat(str(item["sent_at"]))
        ends = datetime.fromisoformat(str(item["expires_at"]))
    except (KeyError, ValueError):
        return ""
    span = max(1, int((ends - sent).total_seconds()))
    left = max(0, int((ends - at).total_seconds()))
    minutes = max(1, -(-left // 60))
    return (
        f'<p class="canccu-front-door__left canccu-muted">{minutes} min left'
        f'<progress max="{span}" value="{left}" aria-hidden="true"></progress></p>'
    )


def urgent(items: list[dict[str, Any]]) -> str:
    """An urgent announcement's banner, full width above everything, until the crew lifts it."""
    rows = [
        '<section class="canccu-front-door__urgent" role="alert">'
        f'<p class="canccu-overline">{ui.icon("alert")}Urgent</p>'
        f"<h2>{ui.esc(a.get('title'))}</h2>"
        + (f"<p>{ui.esc(a.get('body'))}</p>" if a.get("body") else "")
        + "<p><small>Stays here until the crew lifts it</small></p></section>"
        for a in items
        if a.get("level") == "urgent"
    ]
    return "".join(rows)


def announcements(items: list[dict[str, Any]], at: datetime) -> str:
    """The live Important and Info announcements under "What's on", newest first as Moments
    lists them: Important as a large card with its time bar, Info as a quiet row (#780, sheet 6).
    One left edge and no box inside a box: each is one bordered block of the card."""
    cards, rows = [], []
    for a in items:
        mark = ui.icon(_ICONS.get(str(a.get("icon")), "info"))
        body = f'<p class="canccu-muted">{ui.esc(a.get("body"))}</p>' if a.get("body") else ""
        if a.get("level") == "important":
            cards.append(
                '<article class="canccu-front-door__important">'
                f'<p class="canccu-overline">{mark}Important</p>'
                f"<h2>{ui.esc(a.get('title'))}</h2>{body}{_left(a, at)}</article>"
            )
        elif a.get("level") == "info":
            rows.append(
                f'<div class="canccu-front-door__info">{mark}'
                f"<p><b>{ui.esc(a.get('title'))}</b></p>{body}</div>"
            )
    if not cards and not rows:
        return ""
    return (
        '<section class="canccu-front-door__announcements" aria-label="Announcements">'
        + "".join(cards + rows)
        + "</section>"
    )


def links(flags: dict[str, bool]) -> str:
    shown = [
        f'<a class="canccu-front-door__link" href="{href}">{ui.icon(ico)}'
        f"<span><b>{ui.esc(label)}</b><small>{ui.esc(about)}</small></span>"
        f"{ui.icon('right')}</a>"
        for module, href, ico, label, about in PUBLIC_PAGES
        if flags.get(f"{module}.enabled", True)
    ]
    if not shown:
        return ""
    return f'<nav class="canccu-front-door__links" aria-label="At the event">{"".join(shown)}</nav>'


def crew(signed_in: bool) -> str:
    """The organisers' way in: admin sends a signed-out browser on to its sign-in."""
    label = "Open admin" if signed_in else "Sign in"
    return (
        '<div class="canccu-front-door__crew"><p class="canccu-overline">Crew &amp; organisers</p>'
        f'<a class="{SECONDARY}" href="/admin/">{ui.icon("lock")}{label}</a></div>'
    )
