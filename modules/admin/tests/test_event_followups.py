"""The lead's follow-ups to the Event page and the admin home (#782 part C, the accept of part B):
one wording for empty values, Venue as rows, the menu marks what the person is on, Screen studio
listed once, the series the tenant names, conflicts that keep what was typed."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import cast

import pytest
from canccu_kit import TenantContext
from canccu_kit.rights import Session
from conftest import World, owner_and_member
from test_event_page import event_page, section
from test_event_save import BASICS, ORIGIN, owner, sent

from canccu_admin.event_views import event_view
from canccu_admin.event_widgets import EventData
from canccu_admin.home_page import home_view


def reader(*rights: str) -> Session:
    return Session("u1", "Aino", frozenset({"admin.settings.read", *rights}), datetime.now(UTC))


EMPTY_TENANT = {
    "name": "Demo Event",
    "short_name": "",
    "description": "",
    "time_zone": "UTC",
    "starts_at": None,
    "ends_at": None,
}


def test_empty_values_read_not_set_in_basics_and_venue() -> None:
    data = EventData(
        tenant=EMPTY_TENANT,
        venue_info={"address": "", "house_rules": "", "wifi": [], "floor_plan": None},
        venue={"id": "v", "name": "Demo Hall", "addresses": []},
    )
    page = event_view(reader(), data)
    basics, venue = section(page, "basics"), section(page, "venue")
    assert "None" not in basics and basics.count("<dd>Not set</dd>") == 4
    assert "not set" not in venue and "none" not in venue
    assert "<dt>Address</dt><dd>Not set</dd>" in venue
    assert "<dt>Wi-Fi</dt><dd>Not set</dd>" in venue
    assert "<dt>House rules</dt><dd>Not set</dd>" in venue


def test_venue_read_only_shows_label_and_value_rows() -> None:
    data = EventData(
        tenant=EMPTY_TENANT,
        venue_info={
            "address": "1 Demo Street",
            "house_rules": "Be kind.",
            "wifi": [{"ssid": "Demo-Guest"}, {"ssid": "Demo-Crew"}],
            "floor_plan": None,
        },
        venue={"id": "v", "name": "Demo Hall", "addresses": ["192.0.2.0/24"]},
    )
    venue = section(event_view(reader(), data), "venue")
    assert "<dt>Venue</dt><dd>Demo Hall</dd>" in venue
    assert "<dt>Address</dt><dd>1 Demo Street</dd>" in venue
    assert "<dt>Wi-Fi</dt><dd>Demo-Guest, Demo-Crew</dd>" in venue
    assert "<dt>Floor plan</dt><dd>Not set</dd>" in venue
    assert "<p>Address:" not in venue


def test_a_refused_venue_read_puts_no_admins_line_above_what_the_viewer_sees() -> None:
    data = EventData(
        tenant=EMPTY_TENANT,
        venue_info={"address": "1 Demo Street", "house_rules": "", "wifi": [], "floor_plan": None},
        venue_status=403,
    )
    venue = section(event_view(reader(), data), "venue")
    assert "see which venue" not in venue
    assert venue.index("1 Demo Street") < venue.index("Only the event&#x27;s admins can change")


def test_web_addresses_with_none_say_so() -> None:
    web = section(event_view(reader(), EventData(tenant=EMPTY_TENANT, hostnames=[])), "web")
    assert "No web addresses yet" in web


def test_web_addresses_refused_show_the_primary_the_viewer_already_has() -> None:
    ctx = cast(TenantContext, {"tenant_id": "demo", "primary_hostname": "demo.platform.test"})
    data = EventData(tenant=EMPTY_TENANT, hostnames_status=403, ctx=ctx)
    web = section(event_view(reader(), data), "web")
    assert "demo.platform.test" in web and "Primary" in web
    bare = EventData(tenant=EMPTY_TENANT, hostnames_status=403)
    assert "No web addresses yet" in section(event_view(reader(), bare), "web")


async def test_the_event_page_marks_no_menu_item_and_leads_back_home(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    page = await event_page(world, caplog)
    assert 'aria-current="page"' not in page
    assert re.search(r'<a class="canccu-crumb" href="/admin/">.*?Home</a>', page, re.S)


def test_the_home_lists_the_screen_studio_once() -> None:
    owner_ = reader("screen.content.read", "screen.devices.read", "screen.zones.write")
    page = home_view(owner_, None, [("main", "Main hall")])
    assert page.count('href="/admin/screen/"') == 1


def test_series_names_the_tenant_s_own_series_until_the_route_exists() -> None:
    tenant = EMPTY_TENANT | {"series_id": "demo-series"}
    series = section(event_view(reader(), EventData(tenant=tenant)), "series")
    assert "demo-series" in series and "Not part of a series" not in series
    alone = section(event_view(reader(), EventData(tenant=EMPTY_TENANT)), "series")
    assert "Not part of a series" in alone


async def test_a_basics_conflict_names_only_the_fields_that_differ(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    world.tenants.event |= {"name": "Demo T-Cup", "short_name": "Cup"}
    world.tenants.revision = 4
    r = await browser.post(
        "/admin/event/basics", data=BASICS | {"name": "Demo T-Cup"}, headers=ORIGIN
    )
    assert r.status_code == 409
    now = r.text.split("Now:")[1].split(".")[0]
    # The name typed is the name stored, "T" and all; only the short name differs.
    assert "short name Cup" in now and "Demo T-Cup" not in now and "start" not in now


async def test_a_contact_conflict_names_the_person_not_their_id(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    olli = next(u for u, _ in await world.store.list_users() if u.name == "Olli")
    world.tenants.event["contact_user_id"] = olli.id
    world.tenants.revision = 4
    r = await browser.post(
        "/admin/event/contact", data={"revision": "3", "contact_user_id": ""}, headers=ORIGIN
    )
    assert r.status_code == 409
    assert "contact person Olli" in r.text and olli.id not in r.text.split("Now:")[1][:80]


async def test_saving_basics_keeps_stored_seconds_when_the_time_was_not_changed(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    world.tenants.event["starts_at"] = "2026-12-04T15:00:30Z"
    r = await browser.post(
        "/admin/event/basics", data=BASICS | {"name": "Demo Cup"}, headers=ORIGIN
    )
    assert r.status_code == 303
    assert sent(world) == ("/api/tenants/current", {"revision": 3, "name": "Demo Cup"})


async def test_a_modules_conflict_keeps_the_switches_as_typed(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    world.tenants.flags_version = 5  # someone saved meanwhile; Food is still on there
    r = await browser.post("/admin/event/modules", data={"flags_version": "4"}, headers=ORIGIN)
    assert r.status_code == 409
    modules = section(r.text, "modules")
    assert re.search(r'name="pizza\.enabled" value="1">', modules), "Food stays off as typed"
    assert 'name="flags_version" value="5"' in modules


async def test_a_floor_plan_conflict_asks_for_the_file_again(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    world.tenants.refuse = (409, "version_conflict")
    r = await browser.post(
        "/admin/event/floor-plan",
        files={"floor_plan": ("plan.png", b"\x89PNG", "image/png")},
        headers=ORIGIN,
    )
    assert r.status_code == 409
    venue = section(r.text, "venue")
    assert "Choose the file again" in venue and "What you typed is kept" not in venue


async def test_the_series_id_reaches_the_page(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    world.tenants.event["series_id"] = "demo-series"
    owner_, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner_).get("/admin/event")
    assert "demo-series" in section(r.text, "series")
