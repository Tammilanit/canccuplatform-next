"""The preview before a change: what moves, what does not and why, and who is told on which
channel (plan issue-187 D10, U9, E7).

Who is told follows the consumers as the contracts describe them: screens read now and next for
every item they may show (never `crew`); Notify's `schedule` topic tells phones about delays and
cancellations of items starting within 120 minutes, once per audience for one delay
(notify.md, Topics and sources); the bot posts on `discord_channel`; a session item's delay moves
the session in the tournament module (events.md). A move is a new plan and announces nothing.
An announcement goes to phones by the `schedule` topic's announcement trigger (no time window) and
to the bot's channel only for a public item (bot.md); screens show the item through its times.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from . import model
from .web import VISIBILITY_LABELS, day_label, esc, hhmm

Action = Literal["delay", "cancel", "move"]
SCHEDULE_WINDOW = timedelta(minutes=120)  # the schedule topic's `within_minutes` 120
PHONE_CHANNELS = frozenset({"push", "discord_dm"})


@dataclass(frozen=True)
class Change:
    """One item as it will be after the change."""

    title: str
    kind: str
    visibility: str
    channels: tuple[str, ...]
    starts_at: datetime
    zone: str | None
    managed: bool


def change_of(
    row: Mapping[str, Any],
    kinds: Mapping[str, Mapping[str, Any]],
    event_channels: Sequence[str],
    starts_at: datetime | None = None,
) -> Change:
    kind = kinds.get(row["kind"])
    channels = model.effective_channels(
        None if row["notify"] is None else list(row["notify"]),
        None if kind is None or kind["notify"] is None else list(kind["notify"]),
        event_channels,
    )
    return Change(
        title=row["title"],
        kind=row["kind"],
        visibility=row["visibility"],
        channels=tuple(channels),
        starts_at=starts_at or row["starts_at"],
        zone=row["zone"],
        managed=row["managed_by"] is not None,
    )


def _audiences(changes: Iterable[Change]) -> str:
    seen = {c.visibility for c in changes}
    return ", ".join(VISIBILITY_LABELS[v].lower() for v in model.VISIBILITIES if v in seen)


Row = tuple[str, str]  # a label and what happens there, as a confirm's rows draw it (sheet 5)


def told(
    action: Action, changes: Sequence[Change], now: datetime, *, announce: bool = True
) -> list[Row]:
    """What each surface does about the change: Screens, Discord and Phones, then Tournament when
    its sessions follow. A quiet change (`announce` false) is announced nowhere: screens show the
    new times with no notice (agenda.md, Notification channels)."""
    rows: list[Row] = []
    shown = [c for c in changes if c.visibility != "crew"]
    if shown:
        where = (
            "Every screen"
            if any(c.zone is None for c in shown)
            else "Screens of zone " + ", ".join(sorted({c.zone for c in shown if c.zone}))
        )
        with_notice = announce and action != "move" and any("screen" in c.channels for c in shown)
        rows.append(
            ("Screens", f"{where}, within a second{', with a notice' if with_notice else ''}.")
        )
    else:
        rows.append(("Screens", "Nothing; crew items never show on a screen."))
    managed = [c.title for c in changes if c.managed]
    following = [("Tournament", f"Its sessions follow ({', '.join(managed)}).")]
    following = following if managed and action == "delay" else []
    if not announce:
        rows.append(("Discord", "No post."))
        rows.append(("Phones", "No push, and a reminder that has gone out does not go out again."))
        return rows + following
    if action == "move":
        rows.append(("Discord", "No post; a move is a new plan."))
        rows.append(("Phones", "No push; a move is a new plan."))
        return rows
    told_items = [c for c in changes if c.kind != "quiet_hours"]
    posts = any("discord_channel" in c.channels and c.visibility != "crew" for c in told_items)
    rows.append(("Discord", "A post in the event's channel." if posts else "No post."))
    soon = [c for c in told_items if c.starts_at - now <= SCHEDULE_WINDOW]
    phones = [c for c in soon if PHONE_CHANNELS & set(c.channels)]
    parts = []
    if phones:
        count = "One notice per audience" if action == "delay" else "A notice"
        parts.append(
            f"{count} ({_audiences(phones)}), to those who follow the schedule"
            " by push or Discord DM."
        )
    elif soon:
        parts.append("Nothing; the item's channels leave phones out.")
    later = len(told_items) - len(soon)
    if later:
        items = "item" if later == 1 else "items"
        parts.append(f"Quiet for {later} {items} starting more than 2 h from now.")
    rows.append(("Phones", " ".join(parts) or "Nothing; quiet hours are never announced."))
    return rows + following


def told_announce(change: Change) -> list[str]:
    """Who hears an organiser's announcement of one item."""
    lines = ["Screens: no extra notice; they show the item in now and next."]
    if PHONE_CHANNELS & set(change.channels):
        lines.append(
            f"Phones: a notice ({_audiences([change])}), to those who follow the schedule"
            " by push or Discord DM."
        )
    else:
        lines.append("Phones: nothing; the item's channels leave phones out.")
    if "discord_channel" in change.channels and change.visibility == "public":
        lines.append("Discord: a post in the event's channel.")
    return lines


def when_moved(value: datetime, before: datetime, tz: ZoneInfo) -> str:
    """A time, with its day when the change moves it to another day."""
    new_day = value.astimezone(tz).date()
    prefix = f"{day_label(new_day)} " if new_day != before.astimezone(tz).date() else ""
    return prefix + hhmm(value, tz)


def moved_line(
    row: Mapping[str, Any], starts: datetime, ends: datetime | None, tz: ZoneInfo
) -> str:
    title, old_ends = row["title"], row["ends_at"]
    if starts == row["starts_at"]:
        if ends is not None and old_ends is not None:
            return f"{title} ends {when_moved(ends, old_ends, tz)} instead of {hhmm(old_ends, tz)}"
        if ends is not None:
            return f"{title} now ends {when_moved(ends, starts, tz)}"
        if old_ends is not None:
            return f"{title} no longer has an end"
        return f"{title} stays at {hhmm(starts, tz)}"
    line = f"{title} {hhmm(row['starts_at'], tz)} → {when_moved(starts, row['starts_at'], tz)}"
    if ends is None and old_ends is not None:
        line += ", with no end"
    elif ends is not None and (old_ends is None or ends - starts != old_ends - row["starts_at"]):
        line += f", until {when_moved(ends, starts, tz)}"
    return line


def preview_html(changed: Sequence[str], kept: Sequence[str], who: Sequence[Row]) -> str:
    """A confirm's facts as label and value rows in the shared card (sheet 5): what changes, what
    stays and why, then what each surface does."""

    def lines(values: Sequence[str]) -> str:
        return "<br>".join(esc(v) for v in values)

    rows = [("Changes", lines(changed))]
    if kept:
        rows.append(("Stays", f'<span class="canccu-agenda-muted">{lines(kept)}</span>'))
    rows += [(label, esc(text)) for label, text in who]
    return confirm_rows(rows)


def confirm_rows(rows: Sequence[tuple[str, str]]) -> str:
    """Rows of a confirm in the shared card; each value is HTML its caller escaped."""
    body = "".join(f"<dt>{esc(label)}</dt><dd>{value}</dd>" for label, value in rows)
    return (
        '<section class="canccu-card canccu-agenda-preview" aria-label="Preview">'
        f'<dl class="canccu-dl">{body}</dl></section>'
    )
