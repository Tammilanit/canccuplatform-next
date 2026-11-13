"""The Settings form of sheet 4: grouped cards, "Was 45.", the save bar and "Couldn't save"."""

from __future__ import annotations

import re
from typing import Any

import pytest
from canccu_kit import tenant_scope
from conftest import World, owner_and_member

from canccu_admin.declarations import DeclarationError, _groups, _parse
from canccu_admin.forms import field_html

ORIGIN = {"origin": "https://admin.example.test"}
SCREEN = "/admin/settings/screen"


async def screen_form(world: World, caplog: pytest.LogCaptureFixture) -> Any:
    owner, _ = await owner_and_member(world, caplog)
    with tenant_scope("demo"):
        await world.service.put_settings("screen", 0, {"offline_after_seconds": 45}, "u1")
    return world.browser(owner)


def field_of(text: str, key: str) -> str:
    """The markup of one field, from its label to the next field."""
    start = text.index(f"for=canccu-field-{key}>")
    end = text.find('<div class="canccu-field', start)
    return text[start : end if end > 0 else None]


async def test_fields_come_in_their_groups_with_a_save_bar(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await screen_form(world, caplog)
    text = (await browser.get(SCREEN)).text
    titles = re.findall(r'<h2 class="canccu-card__title">([^<]+)</h2>', text)
    assert titles == ["Playing", "When the network is slow", "Web pages"]
    assert '<p class="canccu-card__desc">How long a screen waits before it says so.</p>' in text
    # Each setting once, in its group's card.
    assert text.count("name=offline_after_seconds") == 1
    network = text[text.index("When the network is slow") : text.index(">Web pages<")]
    assert "name=heartbeat_seconds" in network and "name=offline_after_seconds" in network
    # Two numbers share a row, as the sheet pairs them.
    assert '<div class="canccu-form__row"><div class="canccu-field"><label' in network
    # The saved value is on the control; "Was" waits hidden until the control differs.
    offline = field_of(text, "offline_after_seconds")
    assert 'value="45" data-canccu-was="45"' in offline
    assert "data-canccu-was-hint hidden>Was 45.</p>" in offline
    assert "data-canccu-error hidden>Use a whole number from 15 to 300.</p>" in offline
    assert '<div class="canccu-savebar" data-canccu-savebar>' in text
    assert 'href="/admin/settings/screen" data-canccu-undo>Undo</a>' in text
    assert "data-canccu-save>Save</button>" in text
    assert 'src="/admin/static/settings.js"' in text
    assert (await browser.get("/admin/static/settings.js")).status_code == 200


async def test_a_refused_save_keeps_what_was_typed(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await screen_form(world, caplog)
    r = await browser.post(
        SCREEN,
        # As the form sends it: a ticked box says "on", an unticked one is left out.
        data={"settings_version": "1", "offline_after_seconds": "3", "progress_bars": "on"},
        headers=ORIGIN,
    )
    assert r.status_code == 400
    assert "Couldn&#x27;t save" in r.text
    # The setting by its label, never its key.
    assert "Screen offline after (seconds) must be from 15 up to 300." in r.text
    offline = field_of(r.text, "offline_after_seconds")
    assert 'value="3" data-canccu-was="45"' in offline
    assert "data-canccu-was-hint>Was 45.</p>" in offline
    assert "data-canccu-count>1 change not saved</span>" in r.text
    assert "data-canccu-save>Save again</button>" in r.text
    with tenant_scope("demo"):
        stored = await world.service.get_settings("screen")
    assert stored["values"] == {"offline_after_seconds": 45}


async def test_a_conflict_compares_with_what_is_saved_now(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await screen_form(world, caplog)
    with tenant_scope("demo"):
        await world.service.put_settings("screen", 1, {"offline_after_seconds": 60}, "u2")
    form = {"settings_version": "1", "offline_after_seconds": "30", "progress_bars": "on"}
    r = await browser.post(SCREEN, data=form, headers=ORIGIN)
    assert r.status_code == 409 and "Someone else saved these settings" in r.text
    assert "name=settings_version value=2>" in r.text
    assert 'value="30" data-canccu-was="60"' in field_of(r.text, "offline_after_seconds")
    # Save again saves over what is saved now.
    r = await browser.post(SCREEN, data={**form, "settings_version": "2"}, headers=ORIGIN)
    assert r.status_code == 303 and r.headers["location"].endswith("?saved=1")
    text = (await browser.get(r.headers["location"])).text
    assert "<div data-canccu-saved>" in text and "data-canccu-failed" not in text


def test_was_names_each_kind_in_words() -> None:
    [box, look, hosts] = _parse(
        "m",
        {
            "settings": [
                {"key": "bars", "type": "boolean", "default": True},
                {"key": "look", "type": "string", "choices": ["high_contrast", "minimal"]},
                {"key": "hosts", "type": "list"},
            ]
        },
    )
    assert "Was on.</p>" in field_html(box, False, True)
    assert 'data-canccu-was=""' in field_html(box, False, False)
    assert "Was High contrast.</p>" in field_html(look, "minimal", "high_contrast")
    changed = field_html(hosts, ["a"], ["a", "b"])
    assert 'data-canccu-was="a, b" data-canccu-list' in changed and "Was a, b.</p>" in changed
    assert "Was empty.</p>" in field_html(hosts, ["a"], [])


def groups(*items: dict[str, Any]) -> list[str]:
    settings = _parse("m", {"settings": [{"key": k, "type": "string"} for k in ("a", "b")]})
    return [g.id for g in _groups("m", {"groups": list(items)}, settings)]


def test_every_setting_is_in_exactly_one_group() -> None:
    both = {"id": "g", "label": "G", "keys": ["a", "b"]}
    assert groups(both) == ["g"]
    with pytest.raises(DeclarationError, match=r"not grouped: \['b'\]"):
        groups({**both, "keys": ["a"]})
    with pytest.raises(DeclarationError, match=r"twice: \['a'\]"):
        groups(both, {"id": "h", "label": "H", "keys": ["a"]})
    with pytest.raises(DeclarationError, match=r"not declared: \['c'\]"):
        groups({**both, "keys": ["a", "b", "c"]})
    with pytest.raises(DeclarationError, match="unique"):
        groups({**both, "keys": ["a"]}, {**both, "keys": ["b"]})
    with pytest.raises(DeclarationError, match="needs a label"):
        groups({"id": "g", "keys": ["a", "b"]})
    with pytest.raises(DeclarationError, match="bad group"):
        groups({**both, "id": "Bad Id"})
