"""What the sign-in page and its neighbours say, state by state (docs/design/mockups.html, sheets 3
and 8; #440). Each returns HTML for the front page's card or the shell's error view; the routes
pick the state. The page tells people what to do, never operator wording such as env names."""

from __future__ import annotations

from urllib.parse import urlencode

from canccu_kit.ui import esc, icon, notice, sign_out_form

from .pages import BASE

SIGN_IN = f"{BASE}/sign-in"
ORGANISERS = '<p class="canccu-overline">Organisers and crew</p>'
PRIMARY = "canccu-button canccu-button--primary canccu-button--lg canccu-button--block"
SECONDARY = "canccu-button canccu-button--secondary canccu-button--lg canccu-button--block"


def _link(href: str, label: str, cls: str = PRIMARY) -> str:
    return f'<a class="{cls}" href="{esc(href)}">{esc(label)}</a>'


def sign_in_card(*, archived: bool, ready: bool, warning: str = "", hidden: str = "") -> str:
    """The card's title follows the event (run it, or look back at an archived one); its body
    follows the platform: Discord's button once sign-in is set up, else no dead button, a way to
    check and the words to pass on."""
    if archived:
        head = "<h1>Sign in to look back</h1>"
        lead = (
            "The event is over. Sign in to read its run of show and settings;"
            " nothing can be changed."
        )
        hint = ""
    else:
        head = "<h1>Sign in to run the event</h1>"
        lead = "Use the Discord account you have a role with. You come back here signed in."
        hint = (
            '<p class="canccu-small canccu-muted">No role yet? Sign in once anyway, then ask'
            " an event owner to give you one.</p>"
        )
    if not ready:
        return (
            ORGANISERS
            + head
            + notice(
                "info",
                "Sign-in isn't switched on yet",
                "The person who installed the platform finishes it in the setup guide."
                " It works here as soon as they do.",
            )
            + _link(SIGN_IN, "Check again", SECONDARY)
            + '<p class="canccu-small canccu-muted">Running the event today? Tell them:'
            " “Discord sign-in is not set up”.</p>"
        )
    label = "Try again with Discord" if warning else "Continue with Discord"
    return (
        ORGANISERS
        + head
        + (warning or f'<p class="canccu-muted">{lead}</p>')
        + f'<form method=post action="{SIGN_IN}">{hidden}<button class="{PRIMARY}">'
        f"{label}</button></form>{hint}"
    )


def no_role_card(user_name: str, event_name: str | None) -> str:
    """Signed in, but no role: who you are, who can help, and a way to check."""
    event = esc(event_name) if event_name else "this event"
    return (
        '<p class="canccu-overline">Signed in</p><h1>No role yet</h1>'
        f"<p>You're signed in as {esc(user_name)}, but you have no role in {event} yet.</p>"
        '<p class="canccu-muted">Ask an event owner to give you one. They now see you under'
        " People. This page lets you in as soon as they do.</p>"
        + _link(f"{BASE}/", "Check again")
        + sign_out_form(
            "Sign in as someone else", "canccu-button canccu-button--ghost canccu-button--block"
        )
    )


def _error(
    ico: str, title: str, text: str, next_step: str, actions: str, *, offline: bool = False
) -> str:
    opening = (
        '<div class="canccu-error canccu-error--warn" data-canccu-offline>'
        if offline
        else '<div class="canccu-error">'
    )
    return (
        f'{opening}<span class="canccu-error__icon">{icon(ico)}</span>'
        f'<h1 class="canccu-error__title">{esc(title)}</h1>'
        f'<p class="canccu-error__text">{esc(text)}</p>'
        + (f'<p class="canccu-error__next">{esc(next_step)}</p>' if next_step else "")
        + f'<div class="canccu-cluster">{actions}</div></div>'
    )


def signed_out_view(return_path: str | None) -> str:
    """A session that ended by itself (idle, its 24 hours, or removed by the owner)."""
    href = f"{SIGN_IN}?{urlencode({'next': return_path})}" if return_path else SIGN_IN
    return _error(
        "lock",
        "You were signed out",
        "A session ends after 4 hours without use, or after 24 hours. Nothing you saved is lost.",
        "",
        _link(href, "Sign in again", "canccu-button canccu-button--primary"),
    )


def offline_view() -> str:
    """Served by sw.js when the phone has no connection; amber, as nothing is wrong with the
    event, and shell.js reloads it once the phone is back online."""
    again = (
        f'<a class="canccu-button canccu-button--primary" href="">{icon("refresh")}Try again</a>'
    )
    return _error(
        "warn",
        "You're offline",
        "Your phone has no connection, so the page can't load. Nothing is wrong with the event.",
        "It loads by itself when you're back online.",
        again,
        offline=True,
    )
