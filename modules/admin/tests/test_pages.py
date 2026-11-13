"""Admin's pages in packages/ui's organiser shell (docs/design/mockups.html, sheets 2 and 4)."""

from __future__ import annotations

import pytest
from canccu_kit import tenant_scope
from conftest import World, owner_and_member


async def test_pages_are_in_the_shell_with_the_event_and_menu(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/settings")
    assert '<meta name="viewport"' in r.text and 'href="/admin/static/ui.css"' in r.text
    assert '<span class="canccu-header__title">Demo Event</span>' in r.text
    assert 'href="/admin/settings" aria-current="page"' in r.text
    # Parts by name, not by module id (UX audit A2).
    assert ">General</p>" in r.text and ">Run of show</p>" in r.text and ">admin<" not in r.text
    assert (await world.client.get("/admin/static/ui.css")).text.startswith("/* @canccu/ui")


async def test_settings_fields_have_units_and_hints(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/settings/screen")
    assert '<span class="canccu-inputgroup__add">seconds</span>' in r.text
    assert "From 5 to 60." in r.text and ">High contrast</option>" in r.text
    assert 'class="canccu-crumb" href="/admin/settings"' in r.text


async def test_health_names_every_part_with_a_badge(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/health-view")
    assert "<b>Admin</b>" in r.text and 'canccu-badge--ok">Running</span>' in r.text


async def test_an_unknown_settings_page_is_not_found_in_words(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/settings/nope")
    assert r.status_code == 404 and 'canccu-error__title">Not found' in r.text
    assert "unknown module" not in r.text


async def test_settings_rows_glance_and_last_changes(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    olli = next(u.id for u, _ in await world.store.list_users() if u.name == "Olli")
    with tenant_scope("demo"):
        await world.service.put_settings("admin", 0, {"timezone": "UTC", "language": "fi"}, olli)
    r = await world.browser(owner).get("/admin/settings")
    # A short summary and the values at a glance, not every label or a count (sheet 2).
    assert ">Time zone, language</p>" in r.text
    assert "UTC · Finnish" in r.text and "today " in r.text and "never changed" in r.text
    assert "Last changes" in r.text
    assert "<b>Olli</b> set General → Language to Finnish" in r.text


async def test_last_changes_name_settings_in_words_never_by_key(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    # The demo profile's load records these: an undeclared module and key, and declared ones.
    owner, _ = await owner_and_member(world, caplog)
    olli = next(u.id for u, _ in await world.store.list_users() if u.name == "Olli")
    with tenant_scope("demo"):
        await world.service.put_settings("pizza", 0, {"ordering_open": False}, olli)
        await world.service.put_settings("screen", 0, {"rotation_seconds": 15}, olli)
        await world.service.put_settings(
            "screen", 1, {"rotation_seconds": 15, "offline_after_seconds": 45}, olli
        )
        await world.service.put_settings("agenda", 0, {"reminder_leads_minutes": [30, 10]}, olli)
    text = (await world.browser(owner).get("/admin/settings")).text
    assert "turned off Pizza → Ordering open" in text
    assert "set Screens → Rotation to 15 s" in text
    assert "set Screens → Screen offline after to 45 s" in text
    assert "set Run of show → Reminder lead times to 30, 10 min" in text
    assert "ordering_open" not in text and "rotation_seconds" not in text
    assert "→ pizza" not in text


async def test_health_has_no_empty_message_column(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/health-view")
    assert "What it says" not in r.text
