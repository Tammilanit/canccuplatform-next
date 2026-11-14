"""The organiser shell's data and small parts: the menu, the event, icons, times, the state badge,
the sign-out form and the HTML document around a page. canccu_kit.ui draws the shell and
canccu_kit.ui_views the other views from them; canccu_kit.ui re-exports them for the modules."""

from __future__ import annotations

import html
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .access import parse_time

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
                    "id": "screen",
                    "label": "Screen studio",
                    "href": "/admin/screen/",
                    "icon": "monitor",
                    "rights": ["screen.devices.read", "screen.zones.write", "screen.ticker.write"],
                },
                {
                    "id": "theme",
                    "label": "Theme studio",
                    "href": "/theming/studio/",
                    "icon": "palette",
                    "rights": ["theming.theme.write"],
                },
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
        {"id": "screen", "label": "Screens"},
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


def bar_for(viewer: Viewer, archived: bool = False) -> list[dict[str, Any]]:
    """The bottom bar's slots this person may open, in order: id, label, href, icon and the
    label under 360 px; Quick add is `quick_add`. An archived event changes nothing, so its bar
    has no Quick add (sheets 2 and 8)."""
    pages = {i["id"]: i for g in menu_for(viewer) for i in g["items"]}
    slots = []
    for slot in MENU["bar"]:
        if slot["id"] == "quick_add" and archived:
            continue
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
def local_time(value: str | datetime, time_zone: str) -> datetime:
    """`value` in the event's time zone; a zone this host doesn't know reads as UTC, not a 500."""
    try:
        zone = ZoneInfo(time_zone)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    return (value if isinstance(value, datetime) else parse_time(value)).astimezone(zone)


def time_label(value: str | datetime, time_zone: str) -> str:
    """ "18:42", in the event's time zone."""
    return local_time(value, time_zone).strftime("%H:%M")


def day_label(value: str | datetime, time_zone: str) -> str:
    """ "Sat 14 Mar", in the event's time zone."""
    moment = local_time(value, time_zone)
    return f"{moment:%a} {moment.day} {moment:%b}"


DASH = "\u2013"  # en dash, between the days of a range


def date_range(event: EventInfo) -> str:
    """The event's days: "Sat 14 \u2013 Sun 15 Mar", or "" without dates."""
    if not event.starts_at:
        return ""
    if not event.ends_at:
        return day_label(event.starts_at, event.time_zone)
    a, b = local_time(event.starts_at, event.time_zone), local_time(event.ends_at, event.time_zone)
    if a.date() == b.date():
        return f"{a:%a} {a.day} {a:%b}"
    if (a.year, a.month) == (b.year, b.month):
        return f"{a:%a} {a.day} {DASH} {b:%a} {b.day} {b:%b}"
    return f"{a:%a} {a.day} {a:%b} {DASH} {b:%a} {b.day} {b:%b}"


def _upcoming(event: EventInfo, now: datetime) -> bool:
    return (
        event.status != "archived"
        and event.starts_at is not None
        and now < local_time(event.starts_at, event.time_zone)
    )


def event_clock(event: EventInfo, now: datetime | None = None) -> str:
    """The event clock, "18:42 UTC", as the page was drawn; before the event starts there is
    none (the badge says when it starts)."""
    now = now or datetime.now().astimezone()
    if _upcoming(event, now):
        return ""
    local = local_time(now, event.time_zone)
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
        day = f"{local_time(event.starts_at, event.time_zone):%a}"
        return f'<span class="canccu-badge canccu-badge--primary">Starts {day}</span>'
    if event.status == "live":
        return '<span class="canccu-badge canccu-badge--ok">Live</span>'
    return '<span class="canccu-badge">Draft</span>'


# Theming's one address for the event's logo, or its initials without one (contracts/theming.md,
# Reading the current theme), so a page shows it without reading the theme.
LOGO_URL = "/theming/logo"
# Tabs a phone shows; the rest sit behind a count (sheet 2: no sideways scroll).
PHONE_TABS = 3


def logo(event: EventInfo | None, cls: str) -> str:
    return f'<img class="{cls}" src="{LOGO_URL}" alt="">' if event else ""


def tabs_nav(title: str, tabs: Sequence[tuple[str, str, bool]]) -> str:
    """A section's sub-pages. On a phone three show, the current one among them, and the rest
    open from "N more" (a popover, no script); a desktop shows them all in their order."""
    here = next((i for i, (_, _, current) in enumerate(tabs) if current), -1)
    shown = set(range(min(PHONE_TABS, len(tabs))))
    if len(tabs) > PHONE_TABS and here >= PHONE_TABS:
        shown = (shown - {PHONE_TABS - 1}) | {here}

    def link(href: str, label: str, current: bool, cls: str = "") -> str:
        attr = f' class="{cls}"' if cls else ""
        mark = ' aria-current="page"' if current else ""
        return f'<a{attr} href="{esc(href)}"{mark}>{esc(label)}</a>'

    links = "".join(
        link(h, label, c, "" if i in shown else "canccu-tabs__extra")
        for i, (h, label, c) in enumerate(tabs)
    )
    rest = [t for i, t in enumerate(tabs) if i not in shown]
    more = (
        '<button class="canccu-tabs__more" type="button" popovertarget="canccu-tabs-more">'
        f'{len(rest)} more</button><div class="canccu-tabs__menu" id="canccu-tabs-more" popover>'
        + "".join(link(*t) for t in rest)
        + "</div>"
        if rest
        else ""
    )
    return f'<nav class="canccu-tabs" aria-label="{esc(title)}">{links}{more}</nav>'


def sign_out_form(label: str, cls: str) -> str:
    return (
        f'<form method="post" action="{MENU["sign_out"]}"><button class="{cls}" type="submit">'
        f"{icon('out')}{esc(label)}</button></form>"
    )


def document(
    title: str,
    body: str,
    *,
    event: EventInfo | None = None,
    css: Iterable[str] = (),
    surface: Literal["admin", "hub"] = "admin",
) -> str:
    """The HTML document around a shell or front page; `css` are the stylesheets, ui.css first.

    The event's look follows ui.css from theming's stable address (contracts/theming.md, The
    current tokens, for pages): organiser pages take the admin tokens, which fall back to the
    platform colours when the theme fails the contrast rules; the hub and check-in the theme's own.
    A hostname with no event answers 404 there and the page keeps ui.css's defaults."""
    full = f"{title} · {event.name}" if event and event.name else title
    tokens = "admin-tokens.css" if surface == "admin" else "tokens.css"
    hrefs = list(css)
    hrefs[1:1] = [f"/theming/current/{tokens}"]
    links = "".join(f'<link rel="stylesheet" href="{esc(href)}">' for href in hrefs)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{esc(full)}</title>{links}</head>"
        f'<body class="canccu-page canccu-surface canccu-surface--{surface}">{body}</body></html>'
    )
