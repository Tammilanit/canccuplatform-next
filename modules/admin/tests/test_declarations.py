from pathlib import Path
from typing import Any

import pytest

from canccu_admin.declarations import (
    DeclarationError,
    Setting,
    _parse,
    check_values,
    load_declarations,
)
from canccu_admin.forms import field_html, from_form
from canccu_admin.service import BadSettings

DECL = Path(__file__).parents[1] / "declarations"


def parse(*settings: dict[str, Any]) -> list[Setting]:
    return _parse("m", {"settings": list(settings)})


def one(**kw: Any) -> list[Setting]:
    return parse({"key": "k", "type": "integer", **kw})


def test_shipped_declarations_load_with_contract_defaults() -> None:
    d = {m: decl.settings for m, decl in load_declarations(DECL).items()}
    assert {"admin", "agenda", "notify", "games"} <= set(d)
    agenda = {s.key: s for s in d["agenda"]}
    assert agenda["reminder_leads_minutes"].default == [30, 10]
    assert agenda["notify_channels"].choices == ("screen", "discord_channel", "discord_dm", "push")
    notify = {s.key: s for s in d["notify"]}
    assert (notify["hourly_cap"].min, notify["hourly_cap"].max) == (1, 60)
    assert notify["topics"].default is None
    assert notify["schedule_lead_minutes"].min is None
    games = {s.key: s for s in d["games"]}
    assert (games["surge_threshold"].min, games["surge_threshold"].max) == (2, 500)


def test_screen_declaration_matches_the_contract() -> None:
    # contracts/screen.md, Settings: the bounds and defaults the screen module reads.
    screen = {s.key: s for s in load_declarations(DECL)["screen"].settings}
    bounded = {
        "heartbeat_seconds": (5, 60, 15),
        "offline_after_seconds": (15, 300, 45),
        "break_min_gap_seconds": (0, 3600, 60),
        "ready_timeout_seconds": (1, 30, 8),
        "photo_dwell_seconds": (5, 60, 8),
    }
    for key, (low, high, default) in bounded.items():
        assert (screen[key].type, screen[key].min, screen[key].max) == ("integer", low, high)
        assert screen[key].default == default
    assert (screen["web_allowlist"].type, screen["web_allowlist"].default) == ("list", [])
    assert (screen["progress_bars"].type, screen["progress_bars"].default) == ("boolean", True)
    appearances = ("default", "high_contrast", "minimal", "broadcast")
    assert screen["ticker_appearance"].choices == appearances
    assert screen["ticker_appearance"].default == "default"
    assert screen["ready_fallback_asset_id"].default == ""
    assert (screen["burn_in_drift"].type, screen["burn_in_drift"].default) == ("boolean", False)
    assert set(screen) == set(bounded) | {
        "web_allowlist",
        "progress_bars",
        "ticker_appearance",
        "ready_fallback_asset_id",
        "burn_in_drift",
    }


@pytest.mark.parametrize(
    "bad",
    [
        {"min": 5, "max": 1},
        {"min": 1, "max": 3, "default": 9},
        {"default": "x"},
        {"default": True},
        {"default": 1.5},
        {"choices": ["a"]},
    ],
)
def test_bad_integer_declarations(bad: dict[str, Any]) -> None:
    with pytest.raises(DeclarationError):
        one(**bad)


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "string", "min": 1},
        {"type": "boolean", "max": 1},
        {"type": "list", "items": "integer", "choices": ["a"]},
        {"type": "list", "items": "string", "min": 1},
        {"type": "list", "items": "float"},
        {"type": "list", "items": "integer", "default": [0], "min": 1},
        {"type": "list", "items": "integer", "default": ["a"]},
        {"type": "list", "choices": ["a"], "default": ["b"]},
        {"type": "list", "default": "a"},
        {"type": "number", "min": 1},
    ],
)
def test_bad_other_declarations(bad: dict[str, Any]) -> None:
    with pytest.raises(DeclarationError):
        parse({"key": "k", **bad})


def test_existing_list_still_string_items() -> None:
    (s,) = parse({"key": "k", "type": "list"})
    assert s.items == "string"
    assert check_values([s], {"k": ["a", "b"]}) is None
    assert check_values([s], {"k": [1]}) is not None


def test_integer_check_values() -> None:
    (s,) = one(min=1, max=10)
    assert check_values([s], {"k": 5}) is None
    for bad in (0, 11, 1.5, True, "5"):
        assert check_values([s], {"k": bad}) is not None


def test_integer_list_check_values() -> None:
    (s,) = parse({"key": "k", "type": "list", "items": "integer", "min": 1, "max": 1440})
    assert check_values([s], {"k": [30, 10]}) is None
    assert check_values([s], {"k": []}) is None
    for bad in ([0], [1441], [True], [1.5], ["3"], "3"):
        assert check_values([s], {"k": bad}) is not None


def test_choice_list_check_values() -> None:
    (s,) = parse({"key": "k", "type": "list", "choices": ["a", "b"]})
    assert check_values([s], {"k": ["a"]}) is None
    assert check_values([s], {"k": ["c"]}) is not None


def test_form_integer_input_and_parse() -> None:
    (s,) = one(min=1, max=60, default=6)
    h = field_html(s, None)
    assert "type=number" in h and "step=1" in h and "min=1" in h and "max=60" in h
    assert from_form([s], {"k": "7"}) == {"k": 7}
    for raw in ("7.5", "x"):
        with pytest.raises(BadSettings):
            from_form([s], {"k": raw})


def test_form_integer_list() -> None:
    (s,) = parse({"key": "k", "type": "list", "items": "integer", "default": [30, 10]})
    assert 'value="30, 10"' in field_html(s, None)
    assert from_form([s], {"k": "30, 5"}) == {"k": [30, 5]}
    with pytest.raises(BadSettings):
        from_form([s], {"k": "30, x"})
