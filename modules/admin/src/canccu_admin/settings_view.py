"""The Settings page's list (docs/design/mockups.html, sheet 2): each part's settings with a short
summary, their current values at a glance and when they last changed, and the last changes beside
them where the window is wide enough."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from canccu_kit.ui import day_label, empty_state, esc, icon, time_label

from .db import SettingsChange
from .declarations import Setting
from .forms import _UNIT, _words

# Per part: what its settings are about, in a few words, and its values at a glance. A glance
# names settings by key; a part not listed here shows its first labels and a count instead.
GROUPS: dict[str, tuple[str, str]] = {
    "admin": ("Time zone, language", "{timezone} · {language}"),
    "agenda": ("Reminders, notification channels", "Reminders {reminder_leads_minutes} min before"),
    "games": ("Surges, games members add", "Surges {surges} · {surge_threshold} players"),
    "notify": ("Topics, push limits, check-in codes", "{hourly_cap} pushes an hour"),
    "screen": (
        "Heartbeat, offline mark, web pages, ticker",
        "Offline after {offline_after_seconds} s",
    ),
}
SHOWN_CHANGES = 6


def _value(value: Any) -> str:
    if isinstance(value, bool):
        return "on" if value else "off"
    if isinstance(value, list):
        return ", ".join(_value(v) for v in value) or "none"
    return _words(value) if isinstance(value, str) and value.islower() else str(value)


def _current(declared: list[Setting], values: Mapping[str, Any]) -> dict[str, str]:
    return {s.key: _value(values.get(s.key, s.default)) for s in declared}


def glance(module: str, declared: list[Setting], values: Mapping[str, Any]) -> tuple[str, str]:
    """The row's sub-line and its values at a glance."""
    if module in GROUPS:
        about, shape = GROUPS[module]
        return about, shape.format_map(_current(declared, values))
    labels = [m.group(1) if (m := _UNIT.match(s.label)) else s.label for s in declared[:3]]
    count = f"{len(declared)} {'setting' if len(declared) == 1 else 'settings'}"
    return ", ".join(labels), count


def when(at: datetime | None, now: datetime, time_zone: str) -> str:
    """ "today 09:12", "Fri 13 Mar" or "never changed", in the event's time zone."""
    if at is None:
        return "never changed"
    if day_label(at, time_zone) == day_label(now, time_zone):
        return f"today {time_label(at, time_zone)}"
    return day_label(at, time_zone)


def _line(change: SettingsChange, key: str, group: str, declared: list[Setting]) -> str:
    setting = next((s for s in declared if s.key == key), None)
    label, unit = (setting.label if setting else key), ""
    if match := _UNIT.match(label):
        label, unit = match.group(1), f" {match.group(2)}"
    value = change.changes[key]
    where = f"{esc(group)} → {esc(label)}"
    if isinstance(value, bool):
        return f"turned {'on' if value else 'off'} {where}"
    if value is None:
        return f"cleared {where}"
    return f"set {where} to {esc(_value(value))}{esc(unit)}"


def last_changes(
    changes: list[SettingsChange],
    names: Mapping[str, str],
    groups: Mapping[str, str],
    declarations: Mapping[str, list[Setting]],
    now: datetime,
    time_zone: str,
) -> str:
    """The side panel: the newest changes across every part, one line per setting."""
    lines = [(change, key) for change in changes for key in sorted(change.changes)][:SHOWN_CHANGES]
    items = "".join(
        f'<li><span class="canccu-muted canccu-num">{esc(when(c.changed_at, now, time_zone))}'
        f"</span><span><b>{esc(names.get(c.actor_user_id, 'Someone'))}</b> "
        f"{_line(c, key, groups.get(c.module, c.module), declarations.get(c.module, []))}"
        "</span></li>"
        for c, key in lines
    )
    body = (
        f'<ul class="canccu-history">{items}</ul>'
        if items
        else '<p class="canccu-muted canccu-small">Nothing has been changed yet.</p>'
    )
    return (
        '<section class="canccu-card canccu-split__side"><h2 class="canccu-card__title">'
        'Last changes</h2><p class="canccu-card__desc">Across every group, newest first.</p>'
        f"{body}</section>"
    )


def settings_list(rows: list[tuple[str, str, str, str, str, str]]) -> str:
    """The list: (href, icon, title, about, glance, when) per part."""
    if not rows:
        return empty_state("sliders", "Nothing to set yet", "No module declares settings.")
    items = "".join(
        f'<a class="canccu-list__row" href="{esc(href)}">'
        f'<span class="canccu-list__icon">{icon(ico)}</span>'
        f'<span class="canccu-list__main"><p class="canccu-list__title">{esc(title)}</p>'
        f'<p class="canccu-list__meta">{esc(about)}</p></span>'
        f'<span class="canccu-list__end"><span class="canccu-list__glance">{esc(values)}'
        f'<span class="canccu-hide-phone">{esc(changed)}</span></span>{icon("right")}</span></a>'
        for href, ico, title, about, values, changed in rows
    )
    return (
        f'<section class="canccu-card canccu-card--flush"><div class="canccu-list">{items}</div>'
        "</section>"
    )
