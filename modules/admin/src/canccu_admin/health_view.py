"""The Health page (docs/design/mockups.html, sheet 4): count tiles, then every part by name with
what it does, its status, what it says with a way on, its version, answer time and log name."""

from __future__ import annotations

from zoneinfo import ZoneInfo

from canccu_kit.ui import esc, time_label

from .health import EVERY_SECONDS, Check, Part
from .pages import BASE, HEALTH_ORDER, HEALTH_WORDS, part_name

# One line per part: what it does for the event.
DOES = {
    "admin": "Sign-in, settings, people",
    "agenda": "The run of show and its reminders",
    "notify": "Pushes and Discord posts",
    "screen": "Screens, zones and what they play",
    "screen-render": "Turns decks into slides",
    "theming": "The event's look",
    "tenants": "Events and their addresses",
    "games": "Games and surges",
    "tournament": "Matches and brackets",
}
# What a part that is down means for the event, so the crew knows how urgent it is.
MEANS = {
    "agenda": "Screens keep the run of show they have; changes wait until it is back.",
    "notify": "Messages wait and go out when it is back.",
    "screen": "Screens keep playing what they have; the Studio can't change them.",
    "screen-render": "New decks wait to be drawn; slides already drawn keep playing.",
    "theming": "Screens and pages keep the look they have.",
    "tenants": "Pages may not find their event, and signing in may fail.",
}
DEVICES = f"{BASE}/screen/devices"


def _clock(check: Check, zone: str) -> str:
    return check.at.astimezone(ZoneInfo(zone)).strftime("%H:%M:%S")


def _says(part: Part, zone: str) -> str:
    """What the part says, with a way on; empty while it runs."""
    if part.status == "ok":
        return ""
    words = []
    if part.answer_ms is None:
        since = f" since {time_label(part.down_since, zone)}" if part.down_since else ""
        words.append(f"No answer{since}.")
    if part.detail:
        words.append(part.detail)
    if part.status == "down" and part.key in MEANS:
        words.append(MEANS[part.key])
    way = ""
    if part.key == "screen":
        way = f'<a class="canccu-way" href="{DEVICES}">Open devices</a>'
    elif part.status == "down":
        way = (
            '<details class="canccu-way"><summary>What to check</summary>'
            "<p>Ask whoever runs the platform to look at "
            f"<code>{esc(part.key)}</code>: is it running, and what does its log say?</p>"
            "</details>"
        )
    return f"{esc(' '.join(words))}{' · ' if words and way else ''}{way}"


def _tiles(check: Check) -> str:
    counts = check.counts()
    tiles = [("", len(check.parts), "parts")] + [
        (f" canccu-stat--{k}", counts[k], HEALTH_WORDS[k].lower())
        for k in ("ok", "degraded", "down")
    ]
    return (
        '<div class="canccu-stats">'
        + "".join(
            f'<div class="canccu-card canccu-stat{cls}"><p class="canccu-stat__value">{n}</p>'
            f'<p class="canccu-stat__label">{label}</p></div>'
            for cls, n, label in tiles
        )
        + "</div>"
    )


def health_body(check: Check, zone: str) -> tuple[str, str]:
    """(the page's description, its body) for one check, in the event's time zone."""
    parts = sorted(check.parts, key=lambda p: (HEALTH_ORDER.get(p.status, 0), part_name(p.key)))
    says = {p.key: _says(p, zone) for p in parts}
    # "What it says" only when some part says something: an empty column is only noise.
    said = any(says.values())
    rows = "".join(
        f"<tr><td><b>{esc(part_name(p.key))}</b>"
        + (f'<span class="canccu-table__sub">{esc(DOES[p.key])}</span>' if p.key in DOES else "")
        + f'</td><td><span class="canccu-badge canccu-badge--{esc(p.status)}">'
        f"{esc(HEALTH_WORDS.get(p.status, p.status))}</span></td>"
        + (f"<td>{says[p.key]}</td>" if said else "")
        + f'<td class="canccu-hide-phone canccu-num">{esc(p.version)}</td>'
        f'<td class="canccu-hide-phone canccu-num">'
        f"{'no answer' if p.answer_ms is None else f'{p.answer_ms} ms'}</td>"
        f'<td class="canccu-hide-phone"><code class="canccu-muted">{esc(p.key)}</code></td></tr>'
        for p in parts
    )
    table = (
        '<section class="canccu-card canccu-card--flush"><table class="canccu-table">'
        f"<thead><tr><th>Part</th><th>Status</th>{'<th>What it says</th>' if said else ''}"
        '<th class="canccu-hide-phone">Version</th><th class="canccu-hide-phone">Answer</th>'
        '<th class="canccu-hide-phone">Log name</th>'
        f"</tr></thead><tbody>{rows}</tbody></table></section>"
    )
    description = (
        f"Every part of the platform, checked every {EVERY_SECONDS} seconds. "
        f"Last check {_clock(check, zone)}."
    )
    # health.js reloads the page as the checks come in; it is the page's only script.
    script = f'<script src="{BASE}/static/health.js" defer></script>'
    return description, _tiles(check) + table + script
