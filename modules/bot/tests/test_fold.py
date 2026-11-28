"""The hourly fold (port of the legacy `stats_history` and `game_play_duration`): minutes folded
into an hour with averages, peaks, the messages' total and player-minutes per activity, and the top
games by player-hours, with no person anywhere."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from canccu_bot.fold import Minute, fold_hour, top_games

HOUR = datetime(2026, 11, 27, 10, 0, tzinfo=UTC)


def minute(n: int, **counts: Any) -> Minute:
    base: dict[str, Any] = {
        "members": None,
        "online": None,
        "idle": None,
        "dnd": None,
        "in_voice": None,
        "messages": None,
        "activities": None,
    }
    return Minute(HOUR + timedelta(minutes=n), **{**base, **counts})


def game(app: str | None, name: str, players: int) -> dict[str, Any]:
    return {"application_id": app, "name": name, "players": players}


def test_averages_peaks_and_the_messages_total() -> None:
    hour = fold_hour(
        HOUR,
        [
            minute(0, members=10, online=4, idle=1, dnd=0, in_voice=2, messages=3),
            minute(1, members=10, online=6, idle=1, dnd=1, in_voice=0, messages=0),
            minute(2, messages=5),  # caught up after a restart: messages only
        ],
    )

    assert hour.minutes == 2
    assert (hour.members, hour.online, hour.idle, hour.dnd, hour.in_voice) == (10, 5, 1, 0.5, 1)
    assert (hour.online_peak, hour.in_voice_peak) == (6, 2)
    assert hour.messages == 8


def test_an_hour_with_the_messages_feed_off_has_no_messages_total() -> None:
    hour = fold_hour(HOUR, [minute(0, online=1)])

    assert hour.messages is None


def test_player_minutes_add_one_minute_per_player_per_counted_minute() -> None:
    """The legacy `test_regular_30s_ticks_match_fixed_interval_formula`, on minute ticks."""
    hour = fold_hour(
        HOUR,
        [
            minute(0, online=3, activities=[game("77", "Racing League", 2)]),
            minute(
                1, online=3, activities=[game("77", "Racing League", 3), game(None, "Indie", 1)]
            ),
        ],
    )

    assert hour.activities == {
        "app:77": ("77", "Racing League", 5),
        "name:indie": (None, "Indie", 1),
    }


def test_a_missed_minute_credits_nothing() -> None:
    """The legacy `test_gap_is_capped_at_max_gap_seconds`: a gap is never filled in."""
    hour = fold_hour(
        HOUR,
        [
            minute(0, online=1, activities=[game("77", "Racing League", 2)]),
            minute(30, online=1, activities=[game("77", "Racing League", 2)]),
        ],
    )

    assert hour.activities["app:77"][2] == 4


def test_a_game_absent_from_a_minute_does_not_accrue() -> None:
    """The legacy `test_game_absent_on_global_tick_does_not_accrue`."""
    hour = fold_hour(
        HOUR,
        [
            minute(
                0, online=1, activities=[game("77", "Racing League", 2), game("88", "Blocks", 1)]
            ),
            minute(1, online=1, activities=[game("77", "Racing League", 2)]),
        ],
    )

    assert hour.activities["app:88"][2] == 1


def test_top_games_order_by_player_hours_and_group_free_text_names() -> None:
    """The legacy `test_compute_games_top_96h_orders_by_player_hours`. A name with no application id
    is free text a member controls (contracts/bot.md, Who plays what), so those are one entry with
    no name."""
    top = top_games(
        [
            ("77", "Racing League", 90),
            ("77", "Racing League", 30),
            ("88", "Blocks", 150),
            (None, "Anything Someone Typed", 20),
            (None, "Other", 10),
        ]
    )

    assert top == [
        {"application_id": "88", "name": "Blocks", "player_hours": 2.5},
        {"application_id": "77", "name": "Racing League", "player_hours": 2.0},
        {"application_id": None, "name": None, "player_hours": 0.5},
    ]


def test_top_games_keep_the_ten_busiest() -> None:
    top = top_games([(str(n), f"Game {n}", n) for n in range(1, 15)])

    assert len(top) == 10 and top[0]["application_id"] == "14"
