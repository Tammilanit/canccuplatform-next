"""The Health menu note for every organiser shell (#478, v8 sheet 2): admin's note endpoint, which
the shell's script reads, and the Health page's live parts, which health.js reads."""

from __future__ import annotations

import pytest
from conftest import START, World, owner_and_member
from test_pages import TROUBLE

from canccu_admin.health import Check, Part

NOTE = "/api/admin/health/note"


async def test_the_note_says_what_admins_menu_says(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    world.watch.latest = TROUBLE
    r = await world.browser(owner).get(NOTE)
    assert r.status_code == 200
    assert r.json() == {"status": "down", "text": "1 down, 1 slow"}
    world.watch.latest = Check(START, (Part("admin", "ok"), Part("agenda", "degraded")))
    assert (await world.browser(owner).get(NOTE)).json() == {"status": "degraded", "text": "1 slow"}


async def test_every_part_running_has_nothing_to_say(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    world.watch.latest = Check(START, (Part("admin", "ok"),))
    assert (await world.browser(owner).get(NOTE)).json() == {"status": "ok", "text": ""}


async def test_the_note_never_waits_for_a_check(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    world.watch.latest = None
    # Every page of every module asks: before the watch's first check there is nothing to say,
    # and asking never starts a check of every part.
    assert (await world.browser(owner).get(NOTE)).json() == {"status": "ok", "text": ""}
    assert world.watch.latest is None


async def test_the_note_needs_the_right_to_open_health(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    _, member = await owner_and_member(world, caplog)
    world.watch.latest = TROUBLE
    assert (await world.browser().get(NOTE)).status_code == 401
    r = await world.browser(member).get(NOTE)
    assert r.status_code == 403 and "down" not in r.text


async def test_the_live_parts_are_the_pages_without_the_shell(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    world.watch.latest = TROUBLE
    r = await world.browser(owner).get("/admin/health-view/live")
    assert r.status_code == 200
    for live in ("tiles", "parts", "last-check"):
        assert f'data-canccu-live="{live}"' in r.text
    assert "Last check 12:00:00." in r.text and "<b>Notifications</b>" in r.text
    # Only what health.js swaps: no menu, header or script to read every 10 seconds.
    assert "canccu-menu" not in r.text and "<script" not in r.text and "<html" not in r.text


async def test_the_live_parts_need_the_right_to_open_health(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    _, member = await owner_and_member(world, caplog)
    world.watch.latest = TROUBLE
    r = await world.browser(member).get("/admin/health-view/live")
    assert "<b>Notifications</b>" not in r.text and r.status_code != 200
