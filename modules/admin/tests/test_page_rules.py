"""Every admin page keeps the page rules (#782): a description under its title, a tooltip on
every status chip, a label and a tooltip on every icon-only button (canccu_kit.page_check)."""

from __future__ import annotations

import pytest
from canccu_kit.page_check import page_problems
from conftest import World, owner_and_member

PAGES = [
    "/admin/",
    "/admin/settings",
    "/admin/settings/admin",
    "/admin/settings/screen",
    "/admin/settings/agenda",
    "/admin/settings/notify",
    "/admin/health-view",
    "/admin/profile",
    "/admin/people",
]


async def test_every_admin_page_keeps_the_page_rules(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    browser = world.browser(owner)
    people = (await browser.get("/admin/people")).text
    person = next(p for p in people.split('href="') if p.startswith("/admin/people/u"))
    for path in [*PAGES, person.split('"')[0]]:
        r = await browser.get(path)
        assert r.status_code == 200, path
        assert page_problems(r.text) == [], path
