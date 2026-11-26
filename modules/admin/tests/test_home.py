"""The admin home (#782 part B, plan D6): the event at a glance, its screens with their live
views, and the pages the person may open."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from canccu_kit.page_check import page_problems
from canccu_kit.rights import Session
from conftest import World, owner_and_member

from canccu_admin.home_page import home_view


def session(*rights: str) -> Session:
    return Session("u1", "Aino", frozenset(rights), datetime(2030, 1, 1, tzinfo=UTC))


async def test_home_lists_each_zone_with_its_live_view(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/")
    assert r.status_code == 200
    assert "Main hall" in r.text and "Stage" in r.text
    assert 'href="/screen/zones/main"' in r.text and 'href="/screen/zones/stage"' in r.text
    assert r.text.count("Open the live view") == 2
    # Read as admin's service, for the request's own event.
    asked = world.screen.seen[-1]
    assert asked.url.params["tenant_id"] == "demo" and "x-canccu-service" in asked.headers
    assert page_problems(r.text) == []


async def test_home_links_the_screen_studio_and_pairing(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/")
    assert 'href="/admin/screen/"' in r.text
    assert 'href="/admin/screen/devices#pair="' in r.text


async def test_screens_not_answering_leave_the_page_with_a_notice(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    world.screen.down = True
    r = await world.browser(owner).get("/admin/")
    assert r.status_code == 200
    assert "Screens didn&#x27;t answer" in r.text
    assert 'href="/admin/screen/"' in r.text


async def test_home_shows_the_event_with_a_link_to_its_details(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/")
    assert "Demo Event" in r.text
    assert "Fri 4 \u2013 Sun 6 Dec" in r.text and "Europe / Helsinki" in r.text
    assert 'href="/admin/event"' in r.text


async def test_home_leads_the_menu_and_lists_the_other_pages(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/")
    assert 'href="/admin/" aria-current="page"' in r.text
    for href in ('href="/agenda/"', 'href="/admin/settings"', 'href="/theming/studio/"'):
        assert href in r.text


async def test_a_person_without_a_role_still_goes_to_sign_in(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    _, member = await owner_and_member(world, caplog)
    r = await world.browser(member).get("/admin/")
    assert r.status_code == 303 and r.headers["location"] == "/admin/sign-in"


def test_no_screens_section_without_a_screen_studio_right() -> None:
    view = home_view(session("moments.announce"), None, [("main", "Main hall")])
    assert "Main hall" not in view and "/admin/screen/" not in view
    assert 'href="/moments/announce"' in view


def test_pair_a_screen_needs_the_pairing_right() -> None:
    zones = [("main", "Main hall")]
    reader = home_view(session("screen.devices.read"), None, zones)
    pairer = home_view(session("screen.devices.read", "screen.devices.pair"), None, zones)
    assert "Open the live view" in reader and "#pair=" not in reader
    assert 'href="/admin/screen/devices#pair="' in pairer


def test_the_event_card_needs_the_event_or_settings_right() -> None:
    event = {"name": "Demo Event", "time_zone": "UTC", "starts_at": None, "ends_at": None}
    assert "/admin/event" not in home_view(session("moments.announce"), event, None)
    assert 'href="/admin/event"' in home_view(session("admin.settings.read"), event, None)
    assert 'href="/admin/event"' in home_view(session("tenants.event.write"), event, None)
