"""Field rules and shapes that need no database."""

from __future__ import annotations

import pytest
from canccu_kit import KitError

from canccu_agenda import model


def test_channels_in_effect_take_the_first_choice_that_is_not_null() -> None:
    event = ["screen", "discord_channel", "push"]
    assert model.effective_channels(None, None, event) == event
    assert model.effective_channels(None, ["push"], event) == ["push"]
    assert model.effective_channels([], ["push"], event) == []  # [] on an item silences it


@pytest.mark.parametrize("value", ["2026-11-20T17:00:00", "tomorrow", 5])
def test_a_time_needs_rfc_3339_with_an_offset(value: object) -> None:
    with pytest.raises(KitError) as err:
        model.parse_time(value, "starts_at")
    assert err.value.code == "invalid_request"


def test_times_are_written_in_utc() -> None:
    parsed = model.parse_time("2026-11-20T19:00:00+02:00", "starts_at")
    assert model.iso(parsed) == "2026-11-20T17:00:00Z"


@pytest.mark.parametrize("value", [[0], [1441], list(range(1, 10)), "10", [True]])
def test_lead_times_are_1_to_1440_and_at_most_8(value: object) -> None:
    with pytest.raises(KitError):
        model.leads(value)


def test_lead_times_null_and_empty_differ() -> None:
    assert model.leads(None) is None
    assert model.leads([]) == []


def test_the_session_link_is_the_agendas_own() -> None:
    with pytest.raises(KitError) as err:
        model.links({"tournament_session_id": "s1"})
    assert err.value.code == "invalid_request"
    assert model.links({"moment_id": "m1"}) == {"tournament_id": None, "moment_id": "m1"}


def test_a_channel_list_may_not_repeat_or_invent() -> None:
    for value in (["push", "push"], ["sms"]):
        with pytest.raises(KitError):
            model.channels(value)
