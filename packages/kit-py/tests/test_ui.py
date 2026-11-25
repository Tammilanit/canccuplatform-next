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


def _menu_json() -> Path:
    # mutmut runs the tests from a copy (mutants/), one level deeper, so walk up, not a fixed depth.
    for parent in Path(__file__).resolve().parents:
        found = parent / "ui" / "src" / "menu.json"
        if found.exists():
            return found
    raise FileNotFoundError("ui/src/menu.json not found above the test")


MENU_JSON = _menu_json()
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


def test_a_menu_item_says_when_its_page_needs_a_look() -> None:
    # Sheets 2 and 4: "Health 1 slow", a status badge at the item's end.
    doc = shell_page(
        "Settings",
        "",
        session=Viewer("admin.settings.read"),
        menu_notes={"health": ("degraded", "1 <slow>")},
    )
    badge = '<span class="canccu-badge canccu-badge--degraded">1 &lt;slow&gt;</span>'
    assert f"Health{badge}</a>" in doc
    assert doc.count("canccu-badge--degraded") == 1


def test_screen_studio_opens_to_a_role_with_content_or_bundle_rights_only() -> None:
    for right in ("screen.content.read", "screen.bundle.write"):
        assert [i["id"] for g in menu_for(Viewer(right)) for i in g["items"]] == ["screen"]
    # No Studio tab opens with it alone (#611): Schedule and Content need screen.content.read.
    assert menu_for(Viewer("screen.content.write")) == []


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
        (403, "admin_access_restricted", "Venue network only"),
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


def test_pages_link_the_event_s_tokens_after_ui_css() -> None:
    # contracts/theming.md, The current tokens, for pages (#432).
    page = shell_page("Settings", "<p>x</p>", css=["/ui/ui.css", "/admin/static/admin.css"])
    assert (
        '<link rel="stylesheet" href="/ui/ui.css">'
        '<link rel="stylesheet" href="/theming/current/admin-tokens.css">'
        '<link rel="stylesheet" href="/admin/static/admin.css">'
    ) in page
    hub = front_page("Check in", "", css=["/ui/ui.css"], surface="hub")
    assert '<link rel="stylesheet" href="/theming/current/tokens.css">' in hub
    assert "admin-tokens.css" not in hub


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


def test_a_front_page_without_an_event_shows_the_platform_poster() -> None:
    """#708: no event resolves (a dev server, a platform-level sign-in): never an empty poster."""
    page = front_page("Sign in", "<h1>Sign in</h1>")
    assert '<div class="canccu-poster__name"></div>' not in page
    assert "/theming/logo" not in page  # no event, so theming has no logo to give
    assert (
        '<div class="canccu-poster canccu-poster--platform">'
        '<span class="canccu-poster__mark" aria-hidden="true">C</span>'
        '<div class="canccu-poster__name">CanccuPlatform</div>'
        '<p class="canccu-poster__meta">Organisers and crew sign in here</p></div>'
    ) in page
    hub = front_page("Check in", "", surface="hub")
    assert '<div class="canccu-poster__name">CanccuPlatform</div></div>' in hub
    assert "Organisers and crew" not in hub


def test_a_front_page_carries_the_privacy_tag_last() -> None:
    """The safety element must be the page's last child, holding text only (packages/ui)."""
    doc = front_page("Check in", "<h1>Check in</h1>", privacy="/notify/privacy")
    assert doc.endswith(
        '<a class="canccu-privacy-link" href="/notify/privacy">Privacy</a></body></html>'
    )
    assert "canccu-front--privacy" in doc
    assert "canccu-privacy-link" not in front_page("Sign in", "")


def test_initials_are_the_avatars_letters() -> None:
    from canccu_kit.ui import initials

    assert initials("demo  player  ii") == "DP"
    assert initials("🎮 Night") == "🎮N"
    assert initials("   ") == "?"


def test_local_time_reads_an_unknown_zone_as_utc() -> None:
    from canccu_kit.ui import local_time

    at = datetime(2026, 11, 14, 17, 0, tzinfo=UTC)
    assert local_time(at, "Europe/Helsinki").hour == 19
    assert local_time("2026-11-14T17:00:00Z", "Mars/Olympus").hour == 17


def test_a_page_description_is_html_by_name() -> None:
    # The page's own words, which may hold markup (Health's live clock): the name says the caller
    # escapes what it puts in, as it does for `body`.
    doc = shell_page("x", "", description_html='Checked <span data-live="1">now</span>.')
    assert '<p class="canccu-pagehead__desc">Checked <span data-live="1">now</span>.</p>' in doc
    with pytest.raises(TypeError):
        shell_page("x", "", description="<b>raw</b>")  # type: ignore[call-arg]


def test_a_failure_after_a_form_post_offers_the_way_back_not_a_retry() -> None:
    failed = KitError("boom", status=500, code="internal_error")
    _, view = error_view(failed, session=Viewer(), back=("/agenda/", "Back to the run of show"))
    assert "Try again</a>" not in view and 'href="/agenda/">Back to the run of show' in view
    _, view = error_view(failed, retry="/agenda/?day=x", back=("/agenda/", "Back"))
    assert 'href="/agenda/?day=x">' in view and ">Back</a>" not in view


def test_off_the_venue_network_says_the_organiser_chose_it_without_wifi_or_vpn() -> None:
    # #778: the restriction is an organiser's choice; there may be no venue Wi-Fi and no VPN.
    _, view = error_view(KitError("x", status=403, code="admin_access_restricted"))
    assert "This event's organiser pages open only from the venue's network." in view
    assert "Ask an organiser if you need in." in view
    assert "VPN" not in view and "Wi-Fi" not in view


def test_off_the_venue_after_a_form_post_offers_the_way_back() -> None:
    refused = KitError("x", status=403, code="admin_access_restricted")
    _, view = error_view(refused, back=("/agenda/", "Back to the run of show"))
    assert "Try again</a>" not in view and "Back to the run of show" in view
