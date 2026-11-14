"""The organiser pages' views beside the shell (docs/design/mockups.html, sheets 3 and 8): the
front door, the error page family, empty states and notices, in the same markup as packages/ui's
shell.ts. Every function returns HTML text with every value escaped; canccu_kit.ui re-exports
them for the modules."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Literal

from .errors import KitError
from .ui_base import (
    EventInfo,
    Viewer,
    date_range,
    document,
    esc,
    icon,
    logo,
    menu_for,
    sign_out_form,
    state_badge,
)


def front_page(
    title: str,
    card: str,
    *,
    event: EventInfo | None = None,
    css: Iterable[str] = (),
    centred: bool = False,
    surface: Literal["admin", "hub"] = "admin",
    now: datetime | None = None,
    privacy: str | None = None,
) -> str:
    """A front door (sign-in, check-in): the event's poster beside or above one card (HTML).
    `privacy` is where the Privacy tag leads: the safety element of pages that take the event's
    look, which must be the page's last child (packages/ui README, the safety elements)."""
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
        f'<div class="canccu-poster">{logo(event, "canccu-poster__logo")}'
        f'<div class="canccu-poster__name{long}">{esc(name)}</div>'
        f"{meta}{venue}</div>"
    )
    centre = " canccu-front__card--center" if centred else ""
    front_card = f'<div class="canccu-front__card{centre}">{card}</div>'
    if privacy:
        # The page keeps a free row at its foot, so the tag never covers the card.
        body = (
            f'<div class="canccu-front canccu-front--privacy">{poster}{front_card}</div>'
            f'<a class="canccu-privacy-link" href="{esc(privacy)}">Privacy</a>'
        )
    else:
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
