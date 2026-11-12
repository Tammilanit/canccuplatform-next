"""The organiser shell's data and small parts: the menu, the event, icons, times and the state
badge. canccu_kit.ui draws the pages from them and re-exports them for the modules."""

from __future__ import annotations

import html
import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# The stylesheet each module serves; its image sets CANCCU_UI_CSS, since an installed kit has no
# packages/ui beside it.
UI_CSS = Path(
    os.environ.get("CANCCU_UI_CSS", Path(__file__).resolve().parents[3] / "ui" / "ui.css")
)

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


def state_badge(event: EventInfo, now: datetime | None = None) -> str:
    """Live, Starts <day>, Archived or Draft, as a badge."""
    now = now or datetime.now().astimezone()
    if event.status == "archived":
        return '<span class="canccu-badge canccu-badge--plain">Archived</span>'
    if event.starts_at and now < _local(event.starts_at, event.time_zone):
        day = f"{_local(event.starts_at, event.time_zone):%a}"
        return f'<span class="canccu-badge canccu-badge--primary">Starts {day}</span>'
    if event.status == "live":
        return '<span class="canccu-badge canccu-badge--ok">Live</span>'
    return '<span class="canccu-badge">Draft</span>'
