"""Event access (#778, #783), now the Event page's Access section (#782): where the organiser
pages open, where paired screens play, who can join and what guests see before signing in, the
tenants contract's `admin_access`, `screen_access`, `membership` and `info_page_mode`
(contracts/tenants.md, Access) in plain words, each with its default.

The values are the tenants module's, so the page reads and saves them through the tenants API as
the person (event_owners.py): their cookie decides the right (`tenants.access.write`, the
event-admin role only) and their address decides `admin_access` itself, never admin's own.
"""

from __future__ import annotations

from canccu_kit import TenantContext

from .pages import BASE

ACCESS = f"{BASE}/access"  # the Access section's form posts here (event_pages.py)
# The default first; the words the crew reads, never the values.
CHOICES = (
    (
        "internet",
        "From anywhere, after signing in",
        "Organisers and crew sign in with Discord and see only what their role allows.",
    ),
    (
        "restricted",
        "Only from the venue's network",
        "Elsewhere the organiser pages say that they open only at the venue. Choose it only "
        "where the venue's network is up whenever the crew needs these pages.",
    ),
)
# Pairing is the trust (#783): the default lets a paired screen play on any network.
SCREEN_CHOICES = (
    (
        "internet",
        "Anywhere, once paired",
        "An organiser pairs each screen with the code it shows, which proves it is the event's. "
        "Screens keep playing on a 4G router or when the venue's address changes.",
    ),
    (
        "restricted",
        "Only on the venue's network",
        "Elsewhere a screen says it is not at the venue. Choose it only where the venue's network "
        "has fixed addresses.",
    ),
)
DEFAULT = "internet"
# Who can join and what guests see (#782): the tenants module's values (core.py), in words.
JOIN_CHOICES = (
    (
        "open",
        "Anyone who signs in at the venue or with the event's link",
        "A person joins from the venue's network or with the join link the event shares.",
    ),
    ("closed", "Only people an event admin adds", "Nobody joins on their own."),
)
INFO_CHOICES = (
    ("public", "The info pages, to anyone", "Guests read the schedule and venue info."),
    (
        "venue_only",
        "The info pages, only at the venue",
        "Elsewhere guests see that the pages open at the venue.",
    ),
    ("sign_in", "Nothing until they sign in", "Guests are asked to sign in first."),
)
# Every access setting on the Event page: its field, its title, its choices, its default.
ACCESS_SETTINGS = (
    ("admin_access", "Where the organiser pages open", CHOICES),
    ("screen_access", "Where screens play", SCREEN_CHOICES),
    ("membership", "Who can join", JOIN_CHOICES),
    ("info_page_mode", "What guests see before signing in", INFO_CHOICES),
)
DEFAULTS = {
    "admin_access": "internet",
    "screen_access": "internet",
    "membership": "open",
    "info_page_mode": "public",
}
READ_ONLY = "Only the event's admins can change this."
WORDS = {value: label for value, label, _ in CHOICES}
SCREEN_WORDS = {value: label for value, label, _ in SCREEN_CHOICES}
# Each setting: its field, its card's title, its choices.
SETTINGS = (
    ("admin_access", "The organiser pages open", CHOICES),
    ("screen_access", "Screens play", SCREEN_CHOICES),
)


def access_row(ctx: TenantContext | None) -> tuple[str, str, str, str, str, str]:
    """The Settings list's row for Event access (settings_view.settings_list)."""
    shown = WORDS.get(ctx["admin_access"], "") if ctx else ""
    return (
        f"{BASE}/event#access",
        "pin",
        "Event access",
        "Where the organiser pages open and screens play",
        shown,
        "",
    )
