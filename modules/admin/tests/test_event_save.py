"""The Event page saves each field through its owner, as the person (#782 part B, plan D7, D8;
the issue's "the Event page saves each field")."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
import pytest
from conftest import World, owner_and_member

ORIGIN = {"origin": "https://admin.example.test"}
BASICS = {
    "revision": "3",
    "name": "Demo Event",
    "short_name": "Demo",
    "starts_at": "2026-12-04T17:00",
    "ends_at": "2026-12-06T14:00",
    "time_zone": "Europe/Helsinki",
    "description": "A weekend of games.",
}


async def owner(world: World, caplog: pytest.LogCaptureFixture) -> httpx.AsyncClient:
    session, _ = await owner_and_member(world, caplog)
    return world.browser(session)


def sent(world: World, method: str = "PATCH") -> tuple[str, Any]:
    last = [r for r in world.tenants.seen if r.method == method][-1]
    return last.url.path, json.loads(last.content)


@pytest.mark.parametrize(
    ("field", "typed", "patched"),
    [
        ("name", "Demo Cup", "Demo Cup"),
        ("short_name", "Cup", "Cup"),
        ("starts_at", "2026-12-04T18:30", "2026-12-04T16:30:00Z"),
        ("ends_at", "2026-12-06T16:00", "2026-12-06T14:00:00Z"),
        ("time_zone", "Europe/Stockholm", "Europe/Stockholm"),
        ("description", "Two days of games.", "Two days of games."),
    ],
)
async def test_basics_patch_exactly_the_changed_field(
    world: World, caplog: pytest.LogCaptureFixture, field: str, typed: str, patched: str
) -> None:
    browser = await owner(world, caplog)
    form = BASICS | {field: typed}
    if field == "time_zone":  # the times stay the wall-clock times typed, in the new zone
        form |= {"starts_at": "2026-12-04T16:00", "ends_at": "2026-12-06T13:00"}
    r = await browser.post("/admin/event/basics", data=form, headers=ORIGIN)
    assert r.status_code == 303 and r.headers["location"] == "/admin/event?saved=basics#basics"
    assert sent(world) == ("/api/tenants/current", {"revision": 3, field: patched})


async def test_start_and_end_are_read_in_the_zone_chosen_in_the_same_form(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    form = BASICS | {"time_zone": "UTC", "starts_at": "2026-12-04T16:00"}
    await browser.post("/admin/event/basics", data=form, headers=ORIGIN)
    _, body = sent(world)
    # 16:00 and 14:00 as typed, in UTC: not in Helsinki, where the form was drawn.
    assert body["time_zone"] == "UTC" and body["starts_at"] == "2026-12-04T16:00:00Z"
    assert body["ends_at"] == "2026-12-06T14:00:00Z"


async def test_a_zone_not_in_the_list_is_refused_in_the_section_s_words(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    r = await browser.post(
        "/admin/event/basics", data=BASICS | {"time_zone": "Mars/Olympus"}, headers=ORIGIN
    )
    assert r.status_code == 400 and "Choose a time zone from the list" in r.text
    assert 'value="Mars/Olympus"' in r.text
    assert not [q for q in world.tenants.seen if q.method == "PATCH"]


async def test_a_stale_revision_keeps_what_was_typed_beside_the_current_values(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    world.tenants.event["name"] = "Demo Event Renamed"
    world.tenants.revision = 4
    r = await browser.post(
        "/admin/event/basics", data=BASICS | {"name": "Demo Cup"}, headers=ORIGIN
    )
    assert r.status_code == 409
    assert 'name="name" value="Demo Cup"' in r.text
    assert "Demo Event Renamed" in r.text and "changed this meanwhile" in r.text
    assert 'name="revision" value="4"' in r.text


async def test_a_refusal_shows_the_owner_s_message_in_the_section(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    world.tenants.refuse = (400, "invalid_request")
    r = await browser.post(
        "/admin/event/basics", data=BASICS | {"name": "Demo Cup"}, headers=ORIGIN
    )
    assert r.status_code == 400 and "raw detail" in r.text
    assert 'name="name" value="Demo Cup"' in r.text


VENUE = {
    "revision": "2",
    "address": "1 Demo Street",
    "house_rules": "Be kind.",
    "wifi_0_ssid": "Demo-Guest",
    "wifi_0_password": "",
    "wifi_0_visibility": "public",
    "wifi_0_note": "",
}


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"address": "2 Demo Road"}, {"address": "2 Demo Road"}),
        ({"house_rules": "No glass."}, {"house_rules": "No glass."}),
        (
            {
                "wifi_1_ssid": "Demo-Crew",
                "wifi_1_password": "crewpass1",
                "wifi_1_visibility": "attendees",
            },
            {
                "wifi": [
                    {"ssid": "Demo-Guest", "password": None, "note": None, "visibility": "public"},
                    {
                        "ssid": "Demo-Crew",
                        "password": "crewpass1",
                        "note": None,
                        "visibility": "attendees",
                    },
                ]
            },
        ),
        (
            {"wifi_0_note": "Ask the desk"},
            {
                "wifi": [
                    {
                        "ssid": "Demo-Guest",
                        "password": None,
                        "note": "Ask the desk",
                        "visibility": "public",
                    }
                ]
            },
        ),
        ({"wifi_0_remove": "1"}, {"wifi": []}),
    ],
)
async def test_venue_info_puts_address_wifi_and_house_rules(
    world: World, caplog: pytest.LogCaptureFixture, change: dict[str, str], expected: dict[str, Any]
) -> None:
    browser = await owner(world, caplog)
    r = await browser.post("/admin/event/venue", data=VENUE | change, headers=ORIGIN)
    assert r.status_code == 303 and r.headers["location"] == "/admin/event?saved=venue#venue"
    path, body = sent(world, "PUT")
    assert path == "/api/tenants/current/venue-info"
    want = {
        "revision": 2,
        "address": "1 Demo Street",
        "house_rules": "Be kind.",
        "wifi": [{"ssid": "Demo-Guest", "password": None, "note": None, "visibility": "public"}],
    }
    assert body == want | expected


async def test_the_floor_plan_is_put_as_the_file(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    png = b"\x89PNG\r\n\x1a\n" + b"\0" * 16
    r = await browser.post(
        "/admin/event/floor-plan",
        files={"floor_plan": ("plan.png", png, "image/png")},
        headers=ORIGIN,
    )
    assert r.status_code == 303 and r.headers["location"] == "/admin/event?saved=venue#venue"
    assert world.tenants.plan == ("image/png", png)


async def test_a_module_switch_puts_the_flags_with_their_version(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    r = await browser.post(
        "/admin/event/modules", data={"flags_version": "4"}, headers=ORIGIN
    )  # an unticked box sends nothing: Food off
    assert r.status_code == 303 and r.headers["location"] == "/admin/event?saved=modules#modules"
    assert sent(world, "PUT") == (
        "/api/tenants/current/flags",
        {"flags_version": 4, "flags": {"pizza.enabled": False}},
    )


async def test_the_contact_person_is_patched(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    olli = next(u for u, _ in await world.store.list_users() if u.name == "Olli")
    r = await browser.post(
        "/admin/event/contact", data={"revision": "3", "contact_user_id": olli.id}, headers=ORIGIN
    )
    assert r.status_code == 303
    assert sent(world) == ("/api/tenants/current", {"revision": 3, "contact_user_id": olli.id})
    page = await browser.get("/admin/event")
    assert f'value="{olli.id}" selected' in page.text


@pytest.mark.parametrize(
    ("field", "value"),
    [("membership", "closed"), ("info_page_mode", "sign_in"), ("admin_access", "restricted")],
)
async def test_access_saves_admin_access_joining_and_info_pages(
    world: World, caplog: pytest.LogCaptureFixture, field: str, value: str
) -> None:
    browser = await owner(world, caplog)
    form = {
        "revision": "3",
        "admin_access": "internet",
        "screen_access": "internet",
        "membership": "open",
        "info_page_mode": "public",
    }
    r = await browser.post("/admin/access", data=form | {field: value}, headers=ORIGIN)
    assert r.status_code == 303 and r.headers["location"] == "/admin/event?saved=access#access"
    assert sent(world)[1][field] == value


async def test_event_access_now_lives_on_the_event_page(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await owner(world, caplog)
    r = await browser.get("/admin/access")
    assert r.status_code == 303 and r.headers["location"] == "/admin/event#access"


@pytest.mark.parametrize(("status", "code"), [(415, "unsupported_type"), (413, "file_too_large")])
async def test_a_refused_floor_plan_answers_the_venue_section_not_an_error_page(
    world: World, caplog: pytest.LogCaptureFixture, status: int, code: str
) -> None:
    browser = await owner(world, caplog)
    world.tenants.refuse = (status, code)
    r = await browser.post(
        "/admin/event/floor-plan",
        files={"floor_plan": ("plan.pdf", b"%PDF-1.4", "application/pdf")},
        headers=ORIGIN,
    )
    assert r.status_code == status
    venue = re.search(r'<section[^>]*id="venue".*?</section>', r.text, re.S)
    assert venue and "Not saved" in venue.group(0)
