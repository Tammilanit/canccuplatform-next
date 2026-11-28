"""The activity counter (port of the legacy `game_detector`'s counting): players per "playing"
activity, from the live presence entries, never who."""

from __future__ import annotations

from typing import Any

from canccu_bot.activities import clean_name, count_activities


def playing(*activities: tuple[str | None, str], status: str = "online") -> dict[str, Any]:
    return {"s": status, "a": [list(a) for a in activities]}


def test_players_are_counted_per_activity_busiest_first() -> None:
    found = count_activities(
        {
            "1": playing(("77", "Racing League")),
            "2": playing(("77", "Racing League")),
            "3": playing(("88", "Block Builder")),
        }
    )

    assert found == [
        {"application_id": "77", "name": "Racing League", "players": 2},
        {"application_id": "88", "name": "Block Builder", "players": 1},
    ]


def test_an_application_id_groups_names_and_the_most_common_name_wins() -> None:
    found = count_activities(
        {
            "1": playing(("77", "Racing League")),
            "2": playing(("77", "Racing League")),
            "3": playing(("77", "Racing League Beta")),
        }
    )

    assert found == [{"application_id": "77", "name": "Racing League", "players": 3}]


def test_an_activity_without_application_id_groups_by_name_ignoring_case() -> None:
    """The legacy `test_detect_games_game_activity_without_application_id`."""
    found = count_activities(
        {"1": playing((None, "Indie Game")), "2": playing((None, "  indie game "))}
    )

    assert found == [{"application_id": None, "name": "Indie Game", "players": 2}]


def test_one_person_counts_once_per_game() -> None:
    found = count_activities({"1": playing(("77", "Racing League"), ("77", "Racing League"))})

    assert found[0]["players"] == 1


def test_offline_people_still_playing_are_counted() -> None:
    """Discord can show an invisible member's game; the legacy counted activities whatever the
    status."""
    found = count_activities({"1": playing(("77", "Racing League"), status="offline")})

    assert found[0]["players"] == 1


def test_names_are_trimmed_and_cut_to_a_sane_length() -> None:
    assert clean_name("  Racing   League ") == "Racing League"
    assert len(clean_name("x" * 500)) == 100
    assert clean_name("   ") == ""
