"""The organiser shell as the Python modules draw it: the same markup as packages/ui's shell.ts."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from canccu_kit import KitError, MissingRight
from canccu_kit.ui import (
    MENU,
    EventInfo,
    bar_for,
    date_range,
    empty_state,
    error_view,
    front_page,
    menu_for,
    notice,
    shell_page,
    time_label,
)

MENU_JSON = Path(__file__).resolve().parents[2] / "ui/src/menu.json"
EVENT = EventInfo(
    name="Demo <Event>",
    status="live",
    time_zone="UTC",
    starts_at="2026-03-14T08:00:00Z",
    ends_at="2026-03-15T16:00:00Z",
    venue="Demo Venue",
)
NOW = datetime(2026, 3, 14, 18, 42, tzinfo=UTC)


class Viewer:
    def __init__(self, *rights: str, name: str = "Demo Organiser") -> None:
        self.user_name = name
        self.rights = frozenset(rights)

    def has(self, right: str) -> bool:
        return right in self.rights


def test_the_menu_is_packages_ui_s_own() -> None:
    assert json.loads(MENU_JSON.read_text()) | {"$comment": None} == MENU | {"$comment": None}


def test_menu_lists_only_pages_the_rights_open() -> None:
    groups = menu_for(Viewer("agenda.crew.read", "admin.settings.read"))
    assert [(g["label"], [i["id"] for i in g["items"]]) for g in groups] == [
        ("Run the event", ["agenda"]),
        ("Admin", ["settings", "health"]),
    ]


def test_shell_page() -> None:
    doc = shell_page(
        "Theme",
        "<p>body</p>",
        current="theme",
        event=EVENT,
        session=Viewer("theming.theme.write"),
        tabs=[
            ("/theming/studio/", "Brand kit", True),
            ("/theming/studio/history", "History", False),
        ],
        now=NOW,
    )
    assert '<meta name="viewport" content="width=device-width, initial-scale=1">' in doc
    assert "Demo &lt;Event&gt;" in doc and "Demo <Event>" not in doc
    # The Theme studio sits in the menu only: the bar's Screens slot is the Screen studio's.
    assert '<a class="canccu-menu__item" href="/theming/studio/" aria-current="page">' in doc
    assert 'href="/theming/studio/" aria-current="page">Brand kit' in doc
    assert "/agenda/" not in doc and "Quick add" not in doc
    assert '<form method="post" action="/admin/sign-out">' in doc
    assert "Sat 14 \u2013 Sun 15 Mar" in doc
    assert 'class="canccu-badge canccu-badge--ok">Live' in doc
    assert ">18:42<small>UTC</small></time>" in doc


def test_bar_puts_quick_add_in_the_middle() -> None:
    every = Viewer("agenda.items.write", "notify.topics.write", "screen.devices.read")
    assert [b["label"] for b in bar_for(every)] == [
        "Run of show",
        "Notifications",
        "Quick add",
        "Screens",
    ]
    assert [b["id"] for b in bar_for(Viewer("agenda.crew.read"))] == ["agenda"]


def test_no_clock_before_the_event_starts() -> None:
    doc = shell_page("x", "", event=EVENT, now=datetime(2026, 3, 13, 12, tzinfo=UTC))
    assert "Starts Sat" in doc and "canccu-clock" not in doc


def test_more_leaves_out_what_the_bar_shows() -> None:
    doc = shell_page(
        "x", "", event=EVENT, session=Viewer("agenda.items.write", "admin.settings.read")
    )
    assert 'class="canccu-menu__item canccu-menu__item--bar" href="/agenda/"' in doc
    assert 'class="canccu-menu__item" href="/admin/settings"' in doc
    assert "Sat 14 \u2013 Sun 15 Mar \u00b7 Demo Venue" in doc


def test_shell_offers_quick_add_with_the_right() -> None:
    doc = shell_page("x", "", current="agenda", session=Viewer("agenda.items.write"))
    assert 'href="/agenda/add"' in doc


def test_archived_event_has_badge_and_banner() -> None:
    archived = EventInfo(**{**EVENT.__dict__, "status": "archived"})
    doc = shell_page("x", "", event=archived, session=Viewer())
    assert ">Archived<" in doc and "canccu-banner" in doc


def test_an_archived_event_has_no_quick_add_in_the_bar() -> None:
    archived = EventInfo(**{**EVENT.__dict__, "status": "archived"})
    doc = shell_page("x", "", event=archived, session=Viewer("agenda.items.write"))
    assert 'href="/agenda/add"' not in doc and 'href="/agenda/"' in doc


def test_the_header_shows_the_event_s_logo_or_initials() -> None:
    doc = shell_page("x", "", event=EVENT, session=Viewer())
    assert (
        '<header class="canccu-header"><img class="canccu-header__logo" src="/theming/logo" alt="">'
    ) in doc
    assert "canccu-header__logo" not in shell_page("x", "")


def test_a_phone_shows_three_tabs_and_the_rest_behind_a_count() -> None:
    labels = ["Live", "Devices", "Zones", "Schedule", "Content", "Ticker"]
    tabs = [(f"/s/{label}", label, label == "Content") for label in labels]
    doc = shell_page("Studio", "", session=Viewer(), tabs=tabs)
    nav = doc.split('<nav class="canccu-tabs"')[1].split("</nav>")[0]
    assert '<a href="/s/Live">Live</a>' in nav
    assert '<a href="/s/Content" aria-current="page">Content</a>' in nav
    for extra in ("Zones", "Schedule", "Ticker"):
        assert f'<a class="canccu-tabs__extra" href="/s/{extra}">{extra}</a>' in nav
    assert 'popovertarget="canccu-tabs-more">3 more</button>' in nav
    assert '<a href="/s/Zones">Zones</a>' in nav.split('id="canccu-tabs-more"')[1]
    assert "canccu-tabs__more" not in shell_page("x", "", session=Viewer(), tabs=tabs[:3])


def test_no_access_never_shows_the_right() -> None:
    title, view = error_view(
        MissingRight("needs right theming.theme.write"),
        session=Viewer("agenda.crew.read"),
        page="the Theme studio",
        event="Demo Event",
    )
    assert title == "No access"
    assert "the Theme studio" in view and "theming.theme.write" not in view
    assert 'href="/agenda/"' in view


@pytest.mark.parametrize(
    ("status", "code", "title"),
    [
        (404, "not_found", "Not found"),
        (403, "admin_access_restricted", "Not at the venue"),
        (409, "event_archived", "Event archived"),
        (503, "tenants_unavailable", "Something went wrong"),
    ],
)
def test_error_titles_by_case(status: int, code: str, title: str) -> None:
    got, view = error_view(KitError("raw detail", status=status, code=code), session=Viewer())
    assert got == title and "raw detail" not in view


def test_refused_change_in_the_module_s_words() -> None:
    title, view = error_view(KitError("Pick a time.", status=400, code="invalid_request"))
    assert title == "Couldn't do that" and "Pick a time." in view


def test_parts() -> None:
    assert empty_state("calendar", "Nothing yet", "Add one.").startswith(
        '<div class="canccu-empty">'
    )
    assert 'class="canccu-notice canccu-notice--ok" role="status"' in notice("ok", "Saved")
    page = front_page("Sign in", "<h1>Sign in</h1>", event=EVENT, now=NOW)
    assert (
        '<div class="canccu-poster"><img class="canccu-poster__logo" src="/theming/logo" alt="">'
        '<div class="canccu-poster__name">Demo &lt;Event&gt;'
    ) in page


def test_time_is_24_hour_in_the_event_zone() -> None:
    assert time_label("2026-03-14T18:42:00Z", "Europe/Helsinki") == "20:42"
    assert date_range(EVENT) == "Sat 14 \u2013 Sun 15 Mar"
    later = EventInfo(**{**EVENT.__dict__, "ends_at": "2026-04-02T10:00:00Z"})
    assert date_range(later) == "Sat 14 Mar \u2013 Thu 2 Apr"


def test_event_info_from_the_tenants_api() -> None:
    body = {
        "id": "demo",
        "name": "Demo Event",
        "status": "live",
        "time_zone": "UTC",
        "starts_at": None,
        "ends_at": None,
        "venue": {"id": "v", "name": "Demo Venue"},
    }
    assert EventInfo.from_api(body) == EventInfo(
        "Demo Event", "live", "UTC", None, None, "Demo Venue"
    )
    # A draft event shows a guest only its status.
    assert EventInfo.from_api({"id": "demo", "status": "draft"}).name is None


def test_an_error_page_marks_no_menu_item() -> None:
    """An error page is nowhere in the menu (sheet 8): on a phone no bar item is current."""
    doc = shell_page(
        "Not found",
        "<div></div>",
        session=Viewer("agenda.items.write"),
        current="agenda",
        plain=True,
    )
    assert "aria-current" not in doc


def test_a_signed_in_shell_loads_the_offline_fallback() -> None:
    signed_in = shell_page("Settings", "", session=Viewer("admin.settings.read"))
    assert '<script src="/admin/static/shell.js" defer></script>' in signed_in
    assert "shell.js" not in shell_page("Signed out", "")


def test_a_front_page_carries_the_privacy_tag_last() -> None:
    """The safety element must be the page's last child, holding text only (packages/ui)."""
    doc = front_page("Check in", "<h1>Check in</h1>", privacy="/notify/privacy")
    assert doc.endswith(
        '<a class="canccu-privacy-link" href="/notify/privacy">Privacy</a></body></html>'
    )
    assert "canccu-front--privacy" in doc
    assert "canccu-privacy-link" not in front_page("Sign in", "")
