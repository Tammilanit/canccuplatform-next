"""The organiser shell for the Python modules' pages: the same markup as packages/ui's shell.ts
(docs/design/mockups.html, sheets 2, 3, 7 and 8), styled by packages/ui's ui.css, which each
module serves. Every function returns HTML text with every value escaped."""

from __future__ import annotations

import html
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .errors import KitError

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

    user_name: str

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


def _initials(name: str) -> str:
    return "".join(w[0].upper() for w in name.split()[:2]) or "?"


def sign_out_form(label: str, cls: str) -> str:
    return (
        f'<form method="post" action="{MENU["sign_out"]}"><button class="{cls}" type="submit">'
        f"{icon('out')}{esc(label)}</button></form>"
    )


def _current(item_id: str, current: str | None) -> str:
    return ' aria-current="page"' if item_id == current else ""


def _menu(viewer: Viewer, current: str | None) -> str:
    groups = "".join(
        '<div class="canccu-menu__group"><p class="canccu-overline canccu-menu__label">'
        f"{esc(g['label'])}</p>"
        + "".join(
            f'<a class="canccu-menu__item" href="{esc(i["href"])}"{_current(i["id"], current)}>'
            f"{icon(i['icon'])}{esc(i['label'])}</a>"
            for i in g["items"]
        )
        + "</div>"
        for g in menu_for(viewer)
    )
    user = (
        f'<div class="canccu-user"><span class="canccu-avatar" aria-hidden="true">'
        f"{esc(_initials(viewer.user_name))}</span>{esc(viewer.user_name)}</div>"
    )
    foot = user + sign_out_form("Sign out", "canccu-button canccu-button--ghost")
    return (
        f'<nav class="canccu-menu" id="canccu-menu" popover aria-label="Event">{groups}'
        f'<div class="canccu-menu__foot">{foot}</div></nav>'
    )


def _tab(href: str, name: str, label: str, here: bool, cls: str = "") -> str:
    current = ' aria-current="page"' if here else ""
    return (
        f'<a class="canccu-tabbar__item{cls}" href="{esc(href)}"{current}>'
        f"{icon(name)}{esc(label)}</a>"
    )


def _tabbar(viewer: Viewer, current: str | None) -> str:
    first_group = MENU["groups"][0]["label"]
    run = [i for g in menu_for(viewer) if g["label"] == first_group for i in g["items"]]
    links = [_tab(i["href"], i["icon"], i["label"], i["id"] == current) for i in run]
    add = MENU["quick_add"]
    if _may(add, viewer):
        links.insert(1, _tab(add["href"], add["icon"], add["label"], False, " canccu-tabbar__add"))
    more = (
        '<button class="canccu-tabbar__item" type="button" popovertarget="canccu-menu">'
        f"{icon('more')}More</button>"
    )
    return f'<nav class="canccu-tabbar" aria-label="Shortcuts">{"".join(links)}{more}</nav>'


def _header(event: EventInfo | None, now: datetime | None) -> str:
    title = (
        f'<span class="canccu-header__title">{esc(event.name if event else None) or "Event"}</span>'
    )
    dates = date_range(event) if event else ""
    meta = (
        '<span class="canccu-header__sep"></span>'
        f'<span class="canccu-header__meta">{esc(dates)}</span>'
        if dates
        else ""
    )
    badge = state_badge(event, now) if event else ""
    return f'<header class="canccu-header">{title}{meta}{badge}</header>'


def document(
    title: str,
    body: str,
    *,
    event: EventInfo | None = None,
    css: Iterable[str] = (),
    surface: Literal["admin", "hub"] = "admin",
) -> str:
    """The HTML document around a shell or front page; `css` are the stylesheets, ui.css first."""
    full = f"{title} · {event.name}" if event and event.name else title
    links = "".join(f'<link rel="stylesheet" href="{esc(href)}">' for href in css)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{esc(full)}</title>{links}</head>"
        f'<body class="canccu-page canccu-surface canccu-surface--{surface}">{body}</body></html>'
    )


def shell_page(
    title: str,
    body: str,
    *,
    session: Viewer | None = None,
    event: EventInfo | None = None,
    current: str | None = None,
    css: Iterable[str] = (),
    description: str = "",
    crumb: tuple[str, str] | None = None,
    actions: str = "",
    tabs: Sequence[tuple[str, str, bool]] = (),
    narrow: bool = False,
    plain: bool = False,
    now: datetime | None = None,
) -> str:
    """An organiser page in the shell. `body`, `actions` are HTML; `tabs` are (href, label,
    current); `plain` leaves out the title row, for an error view that is its own title."""
    banner = ""
    if event and event.status == "archived":
        banner = (
            f'<div class="canccu-banner" role="status">{icon("archive")}<span><b>Archived.</b> '
            f"{esc(event.name or 'The event')} has ended. Read only.</span></div>"
        )
    head = ""
    if not plain:
        back = (
            f'<a class="canccu-crumb" href="{esc(crumb[0])}">{icon("left")}{esc(crumb[1])}</a>'
            if crumb
            else ""
        )
        desc = f'<p class="canccu-pagehead__desc">{description}</p>' if description else ""
        end = f'<div class="canccu-cluster">{actions}</div>' if actions else ""
        head = (
            f'<div class="canccu-pagehead"><div>{back}<h1 class="canccu-pagehead__title">'
            f"{esc(title)}</h1>{desc}</div>{end}</div>"
        )
    tab_links = "".join(
        f'<a href="{esc(href)}"{' aria-current="page"' if here else ""}>{esc(label)}</a>'
        for href, label, here in tabs
    )
    tab_nav = (
        f'<nav class="canccu-tabs" aria-label="{esc(title)}">{tab_links}</nav>' if tabs else ""
    )
    width = " canccu-main--narrow" if narrow else ""
    main = (
        f'<div class="canccu-content"><main class="canccu-main{width}">'
        f"{head}{tab_nav}{body}</main></div>"
    )
    top = _header(event, now) + banner
    if session is None:
        shell = f'<div class="canccu-shell canccu-shell--bare">{top}{main}</div>'
    else:
        nav, bar = _menu(session, current), _tabbar(session, current)
        shell = f'<div class="canccu-shell">{top}{nav}{main}{bar}</div>'
    return document(title, shell, event=event, css=css)


def front_page(
    title: str,
    card: str,
    *,
    event: EventInfo | None = None,
    css: Iterable[str] = (),
    centred: bool = False,
    surface: Literal["admin", "hub"] = "admin",
    now: datetime | None = None,
) -> str:
    """A front door (sign-in, check-in): the event's poster beside or above one card (HTML)."""
    name = (event.name if event else None) or ""
    long = " canccu-poster__name--long" if len(name) > 28 else ""
    meta = ""
    if event:
        meta = (
            f'<p class="canccu-poster__meta">{esc(date_range(event))}{state_badge(event, now)}</p>'
        )
    venue = (
        f'<p class="canccu-poster__venue">{icon("pin")}{esc(event.venue)}</p>'
        if event and event.venue
        else ""
    )
    poster = (
        f'<div class="canccu-poster"><div class="canccu-poster__name{long}">{esc(name)}</div>'
        f"{meta}{venue}</div>"
    )
    centre = " canccu-front__card--center" if centred else ""
    front_card = f'<div class="canccu-front__card{centre}">{card}</div>'
    body = f'<div class="canccu-front">{poster}{front_card}</div>'
    return document(title, body, event=event, css=css, surface=surface)


_TITLES = {
    "no_access": "No access",
    "not_found": "Not found",
    "not_at_venue": "Not at the venue",
    "archived": "Event archived",
    "failed": "Something went wrong",
    "refused": "Couldn't do that",
}


def _kind(exc: KitError) -> str:
    if exc.status >= 500:
        return "failed"
    if exc.code == "missing_right":
        return "no_access"
    if exc.code == "admin_access_restricted":
        return "not_at_venue"
    if exc.code == "event_archived":
        return "archived"
    if exc.status == 404:
        return "not_found"
    return "refused"


def _button(href: str, label: str, variant: str, ico: str = "") -> str:
    return (
        f'<a class="canccu-button canccu-button--{variant}" href="{esc(href)}">'
        f"{icon(ico) if ico else ''}{esc(label)}</a>"
    )


def error_view(
    exc: KitError,
    *,
    session: Viewer | None = None,
    page: str | None = None,
    event: str | None = None,
    retry: str | None = None,
    back: tuple[str, str] | None = None,
) -> tuple[str, str]:
    """An error page's (title, view): a title by case, one sentence in plain words, the next step
    and a way on. Right ids, paths and addresses stay in the server log (UX audit B3); only a
    refused change shows the module's own message."""
    kind = _kind(exc)
    may_open = [i for g in menu_for(session) for i in g["items"]] if session else []
    home = may_open[0] if may_open else None
    health = next((i for i in may_open if i["id"] == "health"), None)
    again = _button(retry, "Try again", "primary", "refresh") if retry else ""
    way_back = _button(back[0], back[1], "secondary") if back else ""
    name = esc(event) if event else "this event"
    if kind == "no_access":
        go = _button(home["href"], f"Go to {home['label']}", "primary") if home else ""
        other = sign_out_form("Sign in as someone else", "canccu-button canccu-button--ghost")
        parts = (
            "lock",
            f"Your role in {name} doesn't include {esc(page or 'this page')}.",
            "If you need it, ask an event owner to add it to your role.",
            go + other,
        )
    elif kind == "not_found":
        go = _button(home["href"], f"Open {home['label']}", "primary") if home else ""
        text = (
            "There's nothing at this address. It may have been removed, or the link is cut short."
        )
        parts = ("compass", text, "", go or way_back)
    elif kind == "not_at_venue":
        parts = (
            "pin",
            "Organiser pages open only on the venue's network or through the crew's VPN.",
            "Join the venue Wi-Fi and try again. No VPN, or not sure what that is?"
            " Ask an organiser: they can let you in.",
            again,
        )
    elif kind == "archived":
        ended = esc(event) if event else "The event"
        text = f"{ended} has ended. Everything can still be read; nothing can be changed."
        parts = ("archive", text, "", way_back)
    elif kind == "failed":
        if health:
            next_step = "Try again in a moment. If it stays, Health shows which part is down."
            more = _button(health["href"], "Open Health", "secondary")
        else:
            next_step, more = "Try again in a moment. If it stays, tell an organiser.", ""
        parts = (
            "alert",
            "The page didn't load. It's on our side, not yours.",
            next_step,
            again + more,
        )
    else:
        parts = ("alert", esc(exc.message), "", way_back)
    ico, text, next_step, actions = parts
    nxt = f'<p class="canccu-error__next">{next_step}</p>' if next_step else ""
    view = (
        f'<div class="canccu-error"><span class="canccu-error__icon">{icon(ico)}</span>'
        f'<h1 class="canccu-error__title">{esc(_TITLES[kind])}</h1>'
        f'<p class="canccu-error__text">{text}</p>{nxt}'
        f'<div class="canccu-cluster">{actions}</div></div>'
    )
    return _TITLES[kind], view


def empty_state(ico: str, title: str, text: str, action: str = "") -> str:
    """What is missing, why it matters, the one next step (`action` is HTML)."""
    act = f'<div class="canccu-cluster">{action}</div>' if action else ""
    return (
        f'<div class="canccu-empty"><span class="canccu-empty__icon">{icon(ico)}</span>'
        f'<p class="canccu-empty__title">{esc(title)}</p>'
        f'<p class="canccu-empty__text">{esc(text)}</p>{act}</div>'
    )


_NOTICE_ICONS = {"info": "info", "ok": "check-circle", "warn": "warn", "down": "alert"}


def notice(kind: str, title: str, text: str = "", actions: str = "") -> str:
    """A status colour, an icon, a title and a sentence (`actions` is HTML)."""
    role = "alert" if kind == "down" else "status"
    cls = "canccu-notice" if kind == "info" else f"canccu-notice canccu-notice--{kind}"
    body = f"<p>{esc(text)}</p>" if text else ""
    act = f'<div class="canccu-notice__actions">{actions}</div>' if actions else ""
    return (
        f'<div class="{cls}" role="{role}">{icon(_NOTICE_ICONS[kind])}'
        f'<div class="canccu-notice__body"><p class="canccu-notice__title">{esc(title)}</p>'
        f"{body}{act}</div></div>"
    )
