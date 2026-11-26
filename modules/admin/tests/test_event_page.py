"""The Event page (#782 part B, plan D7, D8, D10, D11): every event-specific base setting in one
place, each section read from its owner as the person."""

from __future__ import annotations

import re
from datetime import UTC, datetime

import pytest
from canccu_kit.page_check import page_problems
from canccu_kit.rights import Session
from conftest import World, owner_and_member

from canccu_admin.event_views import EventData, event_view


async def event_page(world: World, caplog: pytest.LogCaptureFixture) -> str:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/event")
    assert r.status_code == 200, r.text
    return r.text


def section(page: str, key: str) -> str:
    found = re.search(rf'<section[^>]*id="{key}".*?</section>', page, re.S)
    assert found, key
    return found.group(0)


async def test_basics_show_every_field_with_times_in_the_event_zone(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    basics = section(await event_page(world, caplog), "basics")
    assert 'name="name" value="Demo Event"' in basics
    assert 'name="short_name" value="Demo"' in basics
    # 15:00 UTC is 17:00 in Helsinki in December.
    assert 'name="starts_at" value="2026-12-04T17:00"' in basics
    assert 'name="ends_at" value="2026-12-06T14:00"' in basics
    assert 'name="time_zone" value="Europe/Helsinki"' in basics
    assert '<option value="Europe/Helsinki">' in basics
    assert "A weekend of games." in basics
    assert 'name="revision" value="3"' in basics


async def test_venue_shows_its_name_read_only_and_the_event_copy_to_edit(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    venue = section(await event_page(world, caplog), "venue")
    assert "Demo Hall" in venue and "192.0.2.0/24" in venue
    assert 'name="address" value="1 Demo Street"' in venue
    assert 'value="Demo-Guest"' in venue and "Be kind." in venue
    assert 'enctype="multipart/form-data"' in venue and 'type="file"' in venue


async def test_web_addresses_list_the_primary_first_read_only(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    web = section(await event_page(world, caplog), "web")
    assert web.index("admin.example.test") < web.index("demo.platform.test")
    assert "Primary" in web and "platform admin" in web and "<form" not in web


async def test_access_says_admin_access_joining_and_info_pages_in_words(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    access = section(await event_page(world, caplog), "access")
    assert "From anywhere, after signing in" in access
    assert "Who can join" in access and "What guests see" in access
    assert 'action="/admin/access"' in access


async def test_modules_say_always_on_show_food_s_switch_and_link_settings(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    modules = section(await event_page(world, caplog), "modules")
    for name in ("Run of show", "Admin", "Sign-in", "Look"):
        assert re.search(rf"{name}</[^>]+>.*?Always on", modules, re.S), name
    assert 'name="pizza.enabled"' in modules and 'href="/pizza/crew/settings"' in modules
    assert 'name="flags_version" value="4"' in modules


async def test_organisers_link_people_and_offer_the_contact(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    organisers = section(await event_page(world, caplog), "organisers")
    assert 'href="/admin/people"' in organisers
    assert "Olli" in organisers and 'name="contact_user_id"' in organisers


async def test_privacy_says_the_retention_and_the_storage_use(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    privacy = section(await event_page(world, caplog), "privacy")
    assert "30 days" in privacy and "12 months" in privacy
    assert "1.2 GB of 2 GB used" in privacy


async def test_series_says_not_part_of_one_when_the_endpoint_is_missing(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    assert "Not part of a series" in section(await event_page(world, caplog), "series")


async def test_an_owner_that_does_not_answer_leaves_its_section_with_a_notice(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    world.tenants.down = {"/api/tenants/current/venue-info"}
    page = await event_page(world, caplog)
    assert "didn&#x27;t answer" in section(page, "venue")
    assert 'name="name" value="Demo Event"' in section(page, "basics")


async def test_the_page_has_its_description_and_the_home_links_it(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    page = await event_page(world, caplog)
    assert page_problems(page) == []


def test_without_the_event_right_the_basics_are_read_only() -> None:
    reader = Session("u1", "Aino", frozenset({"admin.settings.read"}), datetime.now(UTC))
    data = EventData(
        tenant={
            "name": "Demo Event",
            "short_name": "",
            "description": "",
            "time_zone": "UTC",
            "starts_at": None,
            "ends_at": None,
        },
    )
    basics = section(event_view(reader, data), "basics")
    assert "Demo Event" in basics and "<form" not in basics
