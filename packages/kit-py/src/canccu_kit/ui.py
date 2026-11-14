"""The organiser shell for the Python modules' pages: the same markup as packages/ui's shell.ts
(docs/design/mockups.html, sheets 2, 3, 7 and 8), styled by packages/ui's ui.css, which each
module serves. Every function returns HTML text with every value escaped. The modules import
every view from here: canccu_kit.ui_views holds the front door, errors, empty states and
notices."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Any

from .ui_base import (
    DASH,
    MENU,
    EventInfo,
    Viewer,
    bar_for,
    date_range,
    day_label,
    document,
    esc,
    event_clock,
    icon,
    logo,
    menu_for,
    sign_out_form,
    state_badge,
    tabs_nav,
    time_label,
)
from .ui_views import empty_state, error_view, front_page, notice

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


# Admin's script for the shell: it registers the service worker, which shows the offline page when
# a signed-in phone loses its connection (#440), and keeps the menu's Health note from admin's
# checks (#478); only a session's pages need it, as only they have a shell to keep.
SHELL_SCRIPT = '<script src="/admin/static/shell.js" defer></script>'


def _initials(name: str) -> str:
    return "".join(w[0].upper() for w in name.split()[:2]) or "?"


def _current(item_id: str, current: str | None) -> str:
    return ' aria-current="page"' if item_id == current else ""


def _menu(
    viewer: Viewer,
    current: str | None,
    event: EventInfo | None,
    notes: Mapping[str, tuple[str, str]],
) -> str:
    # On a phone the menu is More's sheet: what the bar already shows is left out of it.
    in_bar = {b["id"] for b in bar_for(viewer, _archived(event))}

    def cls(base: str, bar: bool) -> str:
        return f"{base} {base}--bar" if bar else base

    groups = "".join(
        f'<div class="{cls("canccu-menu__group", all(i["id"] in in_bar for i in g["items"]))}">'
        f'<p class="canccu-overline canccu-menu__label">{esc(g["label"])}</p>'
        + "".join(
            f'<a class="{cls("canccu-menu__item", i["id"] in in_bar)}" href="{esc(i["href"])}"'
            f"{_current(i['id'], current)}>{icon(i['icon'])}{esc(i['label'])}"
            f"{_note(notes, i['id'])}</a>"
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


def _note(notes: Mapping[str, tuple[str, str]], item_id: str) -> str:
    if item_id not in notes:
        return ""
    status, text = notes[item_id]
    return f'<span class="canccu-badge canccu-badge--{esc(status)}">{esc(text)}</span>'


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


def _archived(event: EventInfo | None) -> bool:
    return event is not None and event.status == "archived"


def _tabbar(viewer: Viewer, current: str | None, event: EventInfo | None) -> str:
    links = [_tab(slot, current) for slot in bar_for(viewer, _archived(event))]
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
    mark = logo(event, "canccu-header__logo")
    return f'<header class="canccu-header">{mark}{title}{meta}{badge}{end}</header>'


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
    menu_notes: Mapping[str, tuple[str, str]] | None = None,
) -> str:
    """An organiser page in the shell. `body`, `actions` are HTML; `tabs` are (href, label,
    current); `plain` leaves out the title row, for an error view that is its own title;
    `menu_notes` badge a menu item by id with (status, text) when its page needs a look."""
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
    tab_nav = tabs_nav(title, tabs) if tabs else ""
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
        nav, bar = _menu(session, here, event, menu_notes or {}), _tabbar(session, here, event)
        shell = f'<div class="canccu-shell">{top}{nav}{main}{bar}</div>{SHELL_SCRIPT}'
    return document(title, shell, event=event, css=css)
