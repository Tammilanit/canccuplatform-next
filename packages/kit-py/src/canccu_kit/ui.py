"""The organiser shell for the Python modules' pages: the same markup as packages/ui's shell.ts
(docs/design/mockups.html, sheets 2, 3, 7 and 8), styled by packages/ui's ui.css, which each
module serves. Every function returns HTML text with every value escaped."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any, Literal

from .errors import KitError
from .ui_base import (
    DASH,
    MENU,
    EventInfo,
    Viewer,
    bar_for,
    date_range,
    day_label,
    esc,
    event_clock,
    icon,
    menu_for,
    state_badge,
    time_label,
)

# The modules import the shell from here; canccu_kit.ui_base holds its data and small parts.
__all__ = [
    "DASH",
    "MENU",
    "EventInfo",
    "Viewer",
    "bar_for",
    "date_range",
    "day_label",
    "document",
    "empty_state",
    "error_view",
    "esc",
    "event_clock",
    "front_page",
    "icon",
    "menu_for",
    "notice",
    "shell_page",
    "sign_out_form",
    "state_badge",
    "time_label",
]


# Registers admin's service worker, which shows the offline page when a signed-in phone loses its
# connection (#440); only a session's pages need it, as only they have a shell to keep.
OFFLINE_SCRIPT = '<script src="/admin/static/shell.js" defer></script>'


def _initials(name: str) -> str:
    return "".join(w[0].upper() for w in name.split()[:2]) or "?"


def sign_out_form(label: str, cls: str) -> str:
    return (
        f'<form method="post" action="{MENU["sign_out"]}"><button class="{cls}" type="submit">'
        f"{icon('out')}{esc(label)}</button></form>"
    )


def _current(item_id: str, current: str | None) -> str:
    return ' aria-current="page"' if item_id == current else ""


def _menu(viewer: Viewer, current: str | None, event: EventInfo | None) -> str:
    # On a phone the menu is More's sheet: what the bar already shows is left out of it.
    in_bar = {b["id"] for b in bar_for(viewer)}

    def cls(base: str, bar: bool) -> str:
        return f"{base} {base}--bar" if bar else base

    groups = "".join(
        f'<div class="{cls("canccu-menu__group", all(i["id"] in in_bar for i in g["items"]))}">'
        f'<p class="canccu-overline canccu-menu__label">{esc(g["label"])}</p>'
        + "".join(
            f'<a class="{cls("canccu-menu__item", i["id"] in in_bar)}" href="{esc(i["href"])}"'
            f"{_current(i['id'], current)}>{icon(i['icon'])}{esc(i['label'])}</a>"
            for i in g["items"]
        )
        + "</div>"
        for g in menu_for(viewer)
    )
    about = " · ".join(x for x in (date_range(event) if event else "", event and event.venue) if x)
    sheet = (
        '<div class="canccu-menu__sheet"><p class="canccu-menu__title">More</p>'
        '<button class="canccu-button canccu-button--ghost" type="button" '
        f'popovertarget="canccu-menu" popovertargetaction="hide">{icon("close")}Close</button>'
        + (f'<p class="canccu-menu__about">{esc(about)}</p>' if about else "")
        + "</div>"
    )
    user = (
        f'<div class="canccu-user"><span class="canccu-avatar" aria-hidden="true">'
        f"{esc(_initials(viewer.user_name))}</span>{esc(viewer.user_name)}</div>"
    )
    foot = user + sign_out_form("Sign out", "canccu-button canccu-button--ghost")
    return (
        f'<nav class="canccu-menu" id="canccu-menu" popover aria-label="Event">{sheet}{groups}'
        f'<div class="canccu-menu__foot">{foot}</div></nav>'
    )


def _tab(slot: dict[str, Any], current: str | None) -> str:
    label = esc(slot["label"])
    if slot["narrow"]:
        label = (
            f'<span class="canccu-tabbar__wide">{label}</span>'
            f'<span class="canccu-tabbar__narrow">{esc(slot["narrow"])}</span>'
        )
    if slot["id"] == "quick_add":
        cls, here = "canccu-tabbar__item canccu-tabbar__add", ""
    else:
        cls, here = "canccu-tabbar__item", _current(slot["id"], current)
    return f'<a class="{cls}" href="{esc(slot["href"])}"{here}>{icon(slot["icon"])}{label}</a>'


def _tabbar(viewer: Viewer, current: str | None) -> str:
    links = [_tab(slot, current) for slot in bar_for(viewer)]
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
    end = f'<span class="canccu-header__end">{event_clock(event, now) if event else ""}</span>'
    return f'<header class="canccu-header">{title}{meta}{badge}{end}</header>'


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
        # An error page is nowhere in the menu, so nothing in it is marked (sheet 8).
        here = None if plain else current
        nav, bar = _menu(session, here, event), _tabbar(session, here)
        shell = f'<div class="canccu-shell">{top}{nav}{main}{bar}</div>{OFFLINE_SCRIPT}'
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
