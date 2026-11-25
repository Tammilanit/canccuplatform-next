"""Event access (#778): where the organiser pages open, `admin_access` in plain words, read and
saved through the tenants API as the person (contracts/tenants.md, Admin access)."""

from __future__ import annotations

import re

import pytest
from conftest import World, owner_and_member

ANYWHERE = "From anywhere, after signing in"
VENUE = "Only from the venue&#x27;s network"


def checked(page: str) -> list[str]:
    return re.findall(r'type=radio name=admin_access value="(\w+)" checked', page)


async def test_the_switch_is_in_plain_words_with_its_default(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/access")
    assert r.status_code == 200
    assert ANYWHERE in r.text and VENUE in r.text
    # The default is named beside its choice, and nothing speaks of VPNs or Tailscale to crew.
    assert re.search(rf"{ANYWHERE}</label>.*?Default", r.text, re.S)
    assert "VPN" not in r.text and "Tailscale" not in r.text
    assert checked(r.text) == ["internet"]
    assert 'name=revision value="3"' in r.text
    # Read as the person, on the event's own hostname.
    read = world.tenants.seen[-1]
    assert read.headers["host"] == "admin.example.test" and owner in read.headers["cookie"]


async def test_saving_patches_tenants_as_the_person_from_their_own_address(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    browser = world.browser(owner)
    r = await browser.post(
        "/admin/access",
        data={"admin_access": "restricted", "revision": "3"},
        headers={"x-forwarded-for": "198.51.100.7", "origin": "https://admin.example.test"},
    )
    assert r.status_code == 303 and r.headers["location"] == "/admin/access?saved=1"
    patch = world.tenants.seen[-1]
    assert patch.method == "PATCH" and patch.url.path == "/api/tenants/current"
    # Tenants judges `admin_access` by the person's address, never by admin's own.
    assert patch.headers["x-forwarded-for"] == "198.51.100.7"
    assert owner in patch.headers["cookie"]
    assert patch.read() == b'{"revision":3,"admin_access":"restricted"}'
    after = await browser.get("/admin/access?saved=1")
    assert checked(after.text) == ["restricted"] and "Saved" in after.text


async def test_a_stale_form_shows_the_event_as_it_is_now(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).post(
        "/admin/access",
        data={"admin_access": "restricted", "revision": "2"},
        headers={"origin": "https://admin.example.test"},
    )
    assert r.status_code == 409
    assert "changed this meanwhile" in r.text
    assert checked(r.text) == ["internet"] and 'name=revision value="3"' in r.text
    assert world.tenants.admin_access == "internet"


@pytest.mark.parametrize(
    ("code", "title"),
    [("admin_access_restricted", "Venue network only")],
)
async def test_a_refusal_from_tenants_is_the_shell_s_error_page(
    world: World, caplog: pytest.LogCaptureFixture, code: str, title: str
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    world.tenants.refuse = (403, code)
    r = await world.browser(owner).post(
        "/admin/access",
        data={"admin_access": "internet", "revision": "3"},
        headers={"origin": "https://admin.example.test"},
    )
    assert r.status_code == 403 and title in r.text and "raw detail" not in r.text


async def test_a_missing_right_on_save_shows_the_page_read_only(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    # Tenants returned the full body (event.write) but the PATCH needs the event-admin role.
    owner, _ = await owner_and_member(world, caplog)
    world.tenants.refuse = (403, "missing_right")
    r = await world.browser(owner).post(
        "/admin/access",
        data={"admin_access": "restricted", "revision": "3"},
        headers={"origin": "https://admin.example.test"},
    )
    assert r.status_code == 403
    assert ANYWHERE in r.text and "Only the event&#x27;s admins can change this" in r.text
    assert "name=admin_access" not in r.text and "No access" not in r.text


async def test_without_the_event_admin_role_the_page_only_reads(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    world.tenants.full = False  # tenants shows the public fields only
    r = await world.browser(owner).get("/admin/access")
    assert r.status_code == 200
    assert ANYWHERE in r.text and "Only the event&#x27;s admins can change this" in r.text
    assert "name=admin_access" not in r.text and "name=revision" not in r.text


async def test_settings_lists_event_access_with_its_value(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/settings")
    assert 'href="/admin/access"' in r.text and ">Event access</p>" in r.text
    assert ANYWHERE in r.text
