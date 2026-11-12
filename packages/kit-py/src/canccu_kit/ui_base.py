"""The organiser shell's data and small parts: the menu, the event, icons, times and the state
badge. canccu_kit.ui draws the pages from them and re-exports them for the modules."""

from __future__ import annotations

import html
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# packages/ui/src/menu.json, which tests/test_ui.py holds this copy to.
MENU: dict[str, Any] = {
    "groups": [
        {
            "label": "Run the event",
            "items": [
                {
                    "id": "agenda",
                    "label": "Run of show",
                    "href": "/agenda/",
                    "icon": "calendar",
                    "rights": ["agenda.items.write", "agenda.crew.read"],
                },
                {
                    "id": "notify",
                    "label": "Notifications",
                    "href": "/notify/admin/topics",
                    "icon": "bell",
                    "rights": ["notify.topics.write", "notify.stats.read"],
                },
            ],
        },
        {
            "label": "Screens and look",
            "items": [
                {
                    "id": "theme",
                    "label": "Theme studio",
                    "href": "/theming/studio/",
                    "icon": "palette",
                    "rights": ["theming.theme.write"],
                }
            ],
        },
        {
            "label": "Admin",
            "items": [
                {
                    "id": "settings",
                    "label": "Settings",
                    "href": "/admin/settings",
                    "icon": "sliders",
                    "rights": ["admin.settings.read"],
                },
                {
                    "id": "health",
                    "label": "Health",
                    "href": "/admin/health-view",
                    "icon": "pulse",
                    "rights": ["admin.settings.read"],
                },
                {
                    "id": "profile",
                    "label": "Event profile",
                    "href": "/admin/profile",
                    "icon": "box",
                    "rights": ["admin.profile.read"],
                },
                {
                    "id": "people",
                    "label": "People",
                    "href": "/admin/people",
                    "icon": "users",
                    "rights": ["admin.rights.write"],
                },
            ],
        },
    ],
    "quick_add": {
        "label": "Quick add",
        "href": "/agenda/add",
        "icon": "plus",
        "rights": ["agenda.items.write"],
    },
    "bar": [
        {"id": "agenda", "label": "Run of show", "narrow": "Show"},
        {"id": "notify", "label": "Notifications"},
        {"id": "quick_add"},
        {"id": "theme", "label": "Theme"},
    ],
    "sign_out": "/admin/sign-out",
}


class Viewer(Protocol):
    """Who is signed in: the kit's Session."""

    @property
    def user_name(self) -> str: ...

    def has(self, right: str) -> bool: ...


@dataclass(frozen=True)
class EventInfo:
    """The event as `GET /api/tenants/current` describes it to anyone (contracts/tenants.md)."""

    name: str | None
    status: str
    time_zone: str = "UTC"
    starts_at: str | None = None
    ends_at: str | None = None
    venue: str | None = None

    @classmethod
    def from_api(cls, body: Mapping[str, Any]) -> EventInfo:
        venue = body.get("venue")
        return cls(
            name=body.get("name"),
            status=str(body.get("status", "live")),
            time_zone=str(body.get("time_zone") or "UTC"),
            starts_at=body.get("starts_at"),
            ends_at=body.get("ends_at"),
            venue=venue.get("name") if isinstance(venue, Mapping) else None,
        )


def esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _may(item: Mapping[str, Any], viewer: Viewer) -> bool:
    return any(viewer.has(r) for r in item["rights"])


def menu_for(viewer: Viewer) -> list[dict[str, Any]]:
    """The menu's groups with only the pages this person may open; empty groups are left out."""
    groups = [
        {"label": g["label"], "items": [i for i in g["items"] if _may(i, viewer)]}
        for g in MENU["groups"]
    ]
    return [g for g in groups if g["items"]]


def bar_for(viewer: Viewer) -> list[dict[str, Any]]:
    """The bottom bar's slots this person may open, in order: id, label, href, icon and the
    label under 360 px; Quick add is `quick_add`."""
    pages = {i["id"]: i for g in menu_for(viewer) for i in g["items"]}
    slots = []
    for slot in MENU["bar"]:
        page = MENU["quick_add"] if slot["id"] == "quick_add" else pages.get(slot["id"])
        if page is None or not _may(page, viewer):
            continue
        label = slot.get("label") or page["label"]
        slots.append(
            {"id": slot["id"], "label": label, "href": page["href"], "icon": page["icon"]}
            | {"narrow": slot.get("narrow")}
        )
    return slots


def icon(name: str) -> str:
    return f'<span class="canccu-i canccu-i--{esc(name)}" aria-hidden="true"></span>'


# The event's language decides the format (UX audit B5); English is the only one until step 10.
def _local(iso: str, time_zone: str) -> datetime:
    try:
        zone = ZoneInfo(time_zone)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(zone)


def time_label(value: str | datetime, time_zone: str) -> str:
    """ "18:42", in the event's time zone."""
    return _local(value if isinstance(value, str) else value.isoformat(), time_zone).strftime(
        "%H:%M"
    )


def day_label(value: str | datetime, time_zone: str) -> str:
    """ "Sat 14 Mar", in the event's time zone."""
    moment = _local(value if isinstance(value, str) else value.isoformat(), time_zone)
    return f"{moment:%a} {moment.day} {moment:%b}"


DASH = "\u2013"  # en dash, between the days of a range


def date_range(event: EventInfo) -> str:
    """The event's days: "Sat 14 \u2013 Sun 15 Mar", or "" without dates."""
    if not event.starts_at:
        return ""
    if not event.ends_at:
        return day_label(event.starts_at, event.time_zone)
    a, b = _local(event.starts_at, event.time_zone), _local(event.ends_at, event.time_zone)
    if a.date() == b.date():
        return f"{a:%a} {a.day} {a:%b}"
    if (a.year, a.month) == (b.year, b.month):
        return f"{a:%a} {a.day} {DASH} {b:%a} {b.day} {b:%b}"
    return f"{a:%a} {a.day} {a:%b} {DASH} {b:%a} {b.day} {b:%b}"


def _upcoming(event: EventInfo, now: datetime) -> bool:
    return (
        event.status != "archived"
        and event.starts_at is not None
        and now < _local(event.starts_at, event.time_zone)
    )


def event_clock(event: EventInfo, now: datetime | None = None) -> str:
    """The event clock, "18:42 UTC", as the page was drawn; before the event starts there is
    none (the badge says when it starts)."""
    now = now or datetime.now().astimezone()
    if _upcoming(event, now):
        return ""
    local = _local(now.isoformat(), event.time_zone)
    return (
        f'<time class="canccu-clock" datetime="{esc(now.isoformat())}">{local:%H:%M}'
        f"<small>{esc(local.tzname() or event.time_zone)}</small></time>"
    )


def state_badge(event: EventInfo, now: datetime | None = None) -> str:
    """Live, Starts <day>, Archived or Draft, as a badge."""
    now = now or datetime.now().astimezone()
    if event.status == "archived":
        return '<span class="canccu-badge canccu-badge--plain">Archived</span>'
    if _upcoming(event, now) and event.starts_at:
        day = f"{_local(event.starts_at, event.time_zone):%a}"
        return f'<span class="canccu-badge canccu-badge--primary">Starts {day}</span>'
    if event.status == "live":
        return '<span class="canccu-badge canccu-badge--ok">Live</span>'
    return '<span class="canccu-badge">Draft</span>'
