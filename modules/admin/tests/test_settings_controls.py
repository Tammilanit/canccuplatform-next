"""The right control for each kind of setting, and the words that say what it is for (#732)."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from conftest import World
from starlette.datastructures import FormData
from test_settings_form import ORIGIN, field_of, screen_form

from canccu_admin.declarations import DeclarationError, _parse, check_values, load_declarations
from canccu_admin.forms import field_html, from_form
from canccu_admin.zones import zone_groups

DECLARATIONS = Path(__file__).parent.parent / "declarations"


def one(**item: Any) -> Any:
    [setting] = _parse("m", {"settings": [{"key": "k", **item}]})
    return setting


# The declaration format


def test_help_and_example_are_optional_text() -> None:
    plain = one(type="string", default="")
    assert (plain.help, plain.example) == ("", "")
    told = one(type="string", default="", help="Shown on the Food page.", example="Back at 18")
    assert (told.help, told.example) == ("Shown on the Food page.", "Back at 18")
    for bad in ({"help": 3}, {"example": ["x"]}):
        with pytest.raises(DeclarationError, match="must be text"):
            one(type="string", default="", **bad)


def test_choices_from_names_a_known_list_of_a_string_setting() -> None:
    zone = one(type="string", choices_from="timezones", default="UTC")
    assert zone.choices_from == "timezones"
    with pytest.raises(DeclarationError, match="choices_from must be one of"):
        one(type="string", choices_from="planets", default="")
    with pytest.raises(DeclarationError, match="choices_from only applies to string"):
        one(type="integer", choices_from="timezones", default=1)
    with pytest.raises(DeclarationError, match="either choices or choices_from"):
        one(type="string", choices=["UTC"], choices_from="timezones", default="UTC")


def test_a_format_is_color_or_url_of_a_string_setting() -> None:
    assert one(type="string", format="color", default="#ff8800").format == "color"
    assert one(type="string", format="url", default="").format == "url"
    with pytest.raises(DeclarationError, match="format must be one of"):
        one(type="string", format="email", default="")
    with pytest.raises(DeclarationError, match="format only applies to string"):
        one(type="boolean", format="url", default=True)


def test_values_must_fit_the_zone_list_and_the_format() -> None:
    zone = one(type="string", choices_from="timezones", default="UTC")
    assert check_values([zone], {"k": "Europe/Helsinki"}) is None
    assert check_values([zone], {"k": "Mars/Olympus"}) == "k must be a time zone, such as UTC"
    color = one(type="string", format="color", default="#ff8800")
    assert check_values([color], {"k": "#00AA33"}) is None
    assert check_values([color], {"k": "orange"}) == "k must be a colour such as #ff8800"
    link = one(type="string", format="url", default="")
    assert check_values([link], {"k": "https://example.org/page"}) is None
    # Empty is no link, when the default is.
    assert check_values([link], {"k": ""}) is None
    for bad in ("javascript:alert(1)", "example.org", "https://"):
        assert check_values([link], {"k": bad}) == "k must be a link starting https:// or http://"
    with pytest.raises(DeclarationError, match="default invalid"):
        one(type="string", format="color", default="red")


# The zone list


def test_zones_come_grouped_by_region_with_city_names() -> None:
    groups = dict(zone_groups())
    assert ("Europe/Helsinki", "Helsinki") in groups["Europe"]
    assert ("America/Argentina/Buenos_Aires", "Argentina / Buenos Aires") in groups["America"]
    assert list(groups)[:2] == ["Africa", "America"]
    # Old aliases and Etc/ zones are left out; UTC is offered once, in its own group.
    every = [zone for zones in groups.values() for zone, _ in zones]
    assert "EST" not in every and "Etc/GMT+3" not in every and "US/Eastern" not in every
    assert groups["UTC"] == [("UTC", "UTC")]


# The control for each kind


def test_on_or_off_is_a_switch() -> None:
    box = one(type="boolean", label="Show progress bars", default=True)
    html = field_html(box, None)
    assert (
        '<input class="canccu-switch" type=checkbox role=switch id=canccu-field-k name=k checked'
        in html
    )


def test_a_time_zone_is_a_dropdown_by_region_with_the_events_zone_first() -> None:
    zone = one(type="string", label="Time zone", choices_from="timezones", default="UTC")
    html = field_html(zone, "Europe/Helsinki")
    assert '<select class="canccu-input" id=canccu-field-k name=k data-canccu-zones' in html
    first = html.index("<optgroup")
    assert html[first:].startswith('<optgroup label="Suggested">')
    suggested = html[first : html.index("</optgroup>", first)]
    assert '<option value="Europe/Helsinki" selected>Europe / Helsinki</option>' in suggested
    assert '<option value="UTC">UTC</option>' in suggested
    assert '<optgroup label="Europe"><option value="Europe/Amsterdam">Amsterdam</option>' in html
    # Selected once, in Suggested only.
    assert html.count(" selected") == 1


def test_a_saved_zone_not_on_the_list_stays_selectable() -> None:
    zone = one(type="string", label="Time zone", choices_from="timezones", default="UTC")
    html = field_html(zone, "Asia/Calcutta")
    assert '<option value="Asia/Calcutta" selected>Asia / Calcutta</option>' in html


def test_a_list_from_choices_is_a_row_of_chips() -> None:
    channels = one(
        type="list", label="Channels", choices=["screen", "discord_dm", "push"], default=["screen"]
    )
    html = field_html(channels, ["push", "screen"])
    assert (
        '<fieldset class="canccu-field" data-canccu-was="screen, push" data-canccu-chips>'
        '<legend class="canccu-field__label">Channels</legend><div class="canccu-chips">'
    ) in html
    assert (
        '<label class="canccu-chip"><input type=checkbox name=k value=screen checked>Screen</label>'
    ) in html
    assert "<input type=checkbox name=k value=discord_dm>Discord DM</label>" in html
    assert "Separate them with commas" not in html
    # Posted as one value per ticked chip, saved in the declared order.
    form = FormData([("k", "push"), ("k", "screen")])
    assert from_form([channels], form) == {"k": ["screen", "push"]}
    assert from_form([channels], FormData([])) == {"k": []}


def test_a_number_has_a_stepper_with_its_unit_and_range() -> None:
    cap = one(type="integer", label="Pushes an hour", min=1, max=60, default=6)
    html = field_html(cap, None)
    assert '<span class="canccu-stepper">' in html
    assert '<button type=button class="canccu-stepper__button" data-canccu-step=-1' in html
    assert 'aria-label="Less">' in html and 'aria-label="More">' in html
    assert "type=number step=1 inputmode=numeric min=1 max=60" in html
    assert '<p class="canccu-field__hint">From 1 to 60. Default: 6.</p>' in html
    assert "data-canccu-pick" not in html


def test_a_duration_has_quick_picks_in_its_range() -> None:
    gap = one(type="integer", label="Least time between (seconds)", min=0, max=3600, default=60)
    html = field_html(gap, None)
    assert 'canccu-inputgroup__add">seconds</span>' in html
    picks = re.findall(r"data-canccu-pick=(\d+)>([^<]+)<", html)
    assert picks == [
        ("5", "5 s"),
        ("15", "15 s"),
        ("45", "45 s"),
        ("120", "2 min"),
        ("600", "10 min"),
        ("3600", "1 h"),
    ]
    assert 'data-canccu-for="canccu-field-k"' in html
    wait = one(type="integer", label="Remind after (minutes)", min=5, max=240, default=30)
    assert re.findall(r"data-canccu-pick=(\d+)>([^<]+)<", field_html(wait, None)) == [
        ("5", "5 min"),
        ("10", "10 min"),
        ("30", "30 min"),
        ("60", "1 h"),
        ("120", "2 h"),
        ("240", "4 h"),
    ]


def test_a_colour_is_a_swatch() -> None:
    accent = one(type="string", label="Accent", format="color", default="#ff8800")
    html = field_html(accent, "#00aa33")
    assert (
        '<input class="canccu-swatch" type=color id=canccu-field-k name=k value="#00aa33"' in html
    )
    assert "Default: #ff8800." in html


def test_a_link_is_a_url_field_with_a_preview() -> None:
    page = one(type="string", label="Info page", format="url", default="", example="https://…")
    html = field_html(page, "https://example.org/info")
    assert 'type=url id=canccu-field-k name=k value="https://example.org/info"' in html
    assert 'placeholder="https://…"' in html
    assert (
        '<a class="canccu-field__preview" data-canccu-preview href="https://example.org/info" '
        'target=_blank rel="noopener noreferrer">Open https://example.org/info</a>'
    ) in html
    # Nothing to open yet: the preview waits hidden.
    assert "data-canccu-preview hidden" in field_html(page, "")


def test_every_field_says_what_it_is_for_with_an_example_and_its_default() -> None:
    note = one(
        type="string",
        label="Note",
        default="",
        help="Shown on the Food page while ordering is off.",
        example="Back at 18:00",
    )
    html = field_html(note, None)
    assert 'placeholder="Back at 18:00"' in html
    assert '<p class="canccu-field__hint">Shown on the Food page while ordering is off.</p>' in html
    leads = one(type="list", items="integer", label="Leads (minutes)", default=[30, 10])
    assert "Separate them with commas. Default: 30, 10.</p>" in field_html(leads, None)
    box = one(type="boolean", label="Bars", help="A thin bar.", default=False)
    assert '<p class="canccu-field__hint">A thin bar. Default: off.</p>' in field_html(box, None)
    pick = one(type="string", label="Look", choices=["default", "high_contrast"], default="default")
    assert "Default: Default.</p>" in field_html(pick, None)


# What each part declares


@pytest.mark.parametrize("path", sorted(DECLARATIONS.glob("*.yaml")), ids=lambda p: p.stem)
def test_every_declared_setting_says_what_it_is_for(path: Path) -> None:
    declared = load_declarations(DECLARATIONS)[path.stem].settings
    for s in declared:
        assert s.help, f"{path.stem}.{s.key} has no help line"
        assert s.help.endswith("."), f"{path.stem}.{s.key}: a help line is a sentence"
        # Real free text shows an example of what to write.
        free = s.type == "string" and not (s.choices or s.choices_from or s.format == "color")
        if free or (s.type == "list" and not s.choices):
            assert s.example, f"{path.stem}.{s.key} has no example"


def test_the_events_time_zone_is_chosen_from_the_zone_list() -> None:
    admin = {s.key: s for s in load_declarations(DECLARATIONS)["admin"].settings}
    assert admin["timezone"].choices_from == "timezones"


async def test_the_screen_form_draws_its_controls(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    browser = await screen_form(world, caplog)
    text = (await browser.get("/admin/settings/screen")).text
    assert "role=switch id=canccu-field-progress_bars name=progress_bars checked" in text
    assert "data-canccu-pick=" in field_of(text, "offline_after_seconds")
    # A stepper's buttons go with the form's script; a save still posts only the values.
    r = await browser.post(
        "/admin/settings/screen",
        data={"settings_version": "1", "offline_after_seconds": "60"},
        headers=ORIGIN,
    )
    assert r.status_code == 303


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_script_drives_picks_steppers_chips_previews_and_zones() -> None:
    here = Path(__file__).parent
    run = subprocess.run(
        [
            "node",
            here / "js/settings_controls.mjs",
            here.parent / "src/canccu_admin/static/settings.js",
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert run.returncode == 0, run.stderr
    assert run.stdout.strip() == "ok"
