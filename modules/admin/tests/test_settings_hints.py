"""Sheet 4's short labels and hints under the settings, emptied fields, and the history's units."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import World
from test_settings_form import ORIGIN, SCREEN, field_of, screen_form

from canccu_admin.db import SettingsChange
from canccu_admin.declarations import DeclarationError, _parse
from canccu_admin.forms import field_html, from_form
from canccu_admin.service import BadSettings
from canccu_admin.settings_form import failure
from canccu_admin.settings_view import last_changes


def one(**item: Any) -> Any:
    [setting] = _parse("m", {"settings": [{"key": "k", **item}]})
    return setting


async def test_the_screen_form_draws_the_sheets_labels_and_hints(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    text = (await (await screen_form(world, caplog)).get(SCREEN)).text
    heartbeat = field_of(text, "heartbeat_seconds")
    assert heartbeat.startswith("for=canccu-field-heartbeat_seconds>Heartbeat</label>")
    assert 'canccu-inputgroup__add">seconds</span>' in heartbeat
    # The declared help line first, then the bounds and the default.
    assert (
        '<p class="canccu-field__hint">How often a screen checks in. From 5 to 60. Default: 15.</p>'
        in (heartbeat)
    )
    offline = field_of(text, "offline_after_seconds")
    assert offline.startswith("for=canccu-field-offline_after_seconds>Mark offline after<")
    assert (
        "Shorter: more false alarms on a slow uplink. From 15 to 300. Default: 45.</p>" in offline
    )
    assert ">Least time between breaks</label>" in text and ">Ticker look</label>" in text
    # A box draws its hint too, under its label.
    bars = field_of(text, "progress_bars")
    assert ">Show progress bars</label>" in bars
    assert (
        '<p class="canccu-field__hint">A thin bar under each rotating slide. Default: on.</p>'
        in bars
    )


def test_short_and_help_are_optional_text() -> None:
    plain = one(type="integer", label="Wait (seconds)", default=3)
    assert (plain.short, plain.help) == ("", "")
    assert ">Wait</label>" in field_html(plain, None)
    for bad in ({"short": 3}, {"help": ["x"]}):
        with pytest.raises(DeclarationError, match="must be text"):
            one(type="integer", default=3, **bad)


def test_a_short_label_keeps_the_unit_of_a_list() -> None:
    leads = one(type="list", items="integer", label="Lead times (minutes)", short="Leads")
    assert ">Leads (minutes)</label>" in field_html(leads, [10])


def test_numbers_and_text_with_a_default_are_required() -> None:
    wait = one(type="integer", min=1, max=9, default=3)
    zone = one(type="string", default="UTC")
    asset = one(type="string", default="")
    hosts = one(type="list", default=[])
    assert " required" in field_html(wait, None) and " required" in field_html(zone, None)
    assert " required" not in field_html(asset, None) + field_html(hosts, None)
    # The browser says why, as the server does.
    assert 'data-canccu-error="Use a whole number from 1 to 9." hidden>' in field_html(wait, None)
    assert '<p class="canccu-field__error" data-canccu-error="Needs a value." hidden>' in (
        field_html(zone, None)
    )
    for s in (wait, zone, one(type="number", default=1.5)):
        with pytest.raises(BadSettings, match="k needs a value"):
            from_form([s], {"k": ""})
    # A text setting that may be empty saves it; one left out of the post stays as it is.
    assert from_form([asset], {"k": ""}) == {"k": ""}
    assert from_form([wait], {}) == {}


async def test_an_emptied_number_is_refused_by_its_label(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await screen_form(world, caplog)
    form = {"settings_version": "1", "heartbeat_seconds": "", "progress_bars": "on"}
    r = await browser.post(SCREEN, data=form, headers=ORIGIN)
    assert r.status_code == 400 and "Heartbeat needs a value." in r.text
    assert "Saved" not in r.text


def test_a_failure_names_the_setting_as_the_form_does() -> None:
    s = one(type="integer", label="Screen heartbeat (seconds)", short="Heartbeat", default=5)
    assert failure([s], BadSettings("k must be from 5 up to 60")).startswith(
        "Heartbeat must be from 5 up to 60."
    )


def line(module: str, values: dict[str, Any], declared: dict[str, Any] | None = None) -> str:
    at = datetime(2026, 3, 14, 9, 0, tzinfo=UTC)
    change = SettingsChange(module, values, "u1", at)
    return last_changes([change], {"u1": "Ada"}, {}, declared or {}, at, "UTC")


def test_a_history_line_puts_a_unit_only_after_numbers() -> None:
    assert "set m → Rotation to 20 s" in line("m", {"rotation_seconds": 20})
    assert "set m → Leads to 10, 5 min" in line("m", {"leads_minutes": [10, 5]})
    # An undeclared key's unit comes from its name: with words, the label keeps it whole.
    assert "set m → Rotation (seconds) to Auto" in line("m", {"rotation_seconds": "auto"})
    words = line("m", {"leads_minutes": ["soon", "later"]})
    assert "set m → Leads (minutes) to Soon, Later" in words
    beat = one(type="integer", label="Screen heartbeat (seconds)", short="Heartbeat", default=5)
    assert "set m → Heartbeat to 20 s" in line("m", {"k": 20}, {"m": [beat]})
