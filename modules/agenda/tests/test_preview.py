"""Who is told about a change, and how a move reads (preview.py); no database needed."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from canccu_agenda.preview import Change, moved_line, told

NOW = datetime(2026, 11, 20, 17, 0, tzinfo=UTC)
TZ = ZoneInfo("Europe/Helsinki")  # UTC+2 in November


def change(**fields: object) -> Change:
    base: dict[str, object] = {
        "title": "Dinner",
        "kind": "meal",
        "visibility": "public",
        "channels": ("screen", "discord_channel", "push"),
        "starts_at": NOW + timedelta(minutes=60),
        "zone": None,
        "managed": False,
    }
    return Change(**{**base, **fields})  # type: ignore[arg-type]


def test_a_delay_tells_screens_phones_once_per_audience_and_discord() -> None:
    rows = told(
        "delay",
        [
            change(),
            change(title="Board games", visibility="attendees"),
            change(title="Semis", managed=True),
        ],
        NOW,
    )
    assert rows == [
        ("Screens", "Every screen, within a second, with a notice."),
        ("Discord", "A post in the event's channel."),
        (
            "Phones",
            "One notice per audience (everyone, attendees), to those who follow the schedule"
            " by push or Discord DM.",
        ),
        ("Tournament", "Its sessions follow (Semis)."),
    ]


def test_items_more_than_two_hours_out_stay_quiet_on_phones() -> None:
    rows = dict(told("cancel", [change(starts_at=NOW + timedelta(minutes=121))], NOW))
    assert rows["Phones"] == "Quiet for 1 item(s) starting more than 2 h from now."


def test_crew_items_never_reach_screens_or_the_channel() -> None:
    rows = dict(told("cancel", [change(visibility="crew", zone="stage")], NOW))
    assert rows["Screens"] == "Nothing; crew items never show on a screen."
    assert rows["Discord"] == "No post."
    assert "(crew only)" in rows["Phones"]


def test_zone_items_reach_only_their_zone_and_silenced_items_no_phone() -> None:
    assert told("delay", [change(zone="cafe", channels=())], NOW) == [
        ("Screens", "Screens of zone cafe, within a second."),
        ("Discord", "No post."),
        ("Phones", "Nothing; the item's channels leave phones out."),
    ]


def test_a_move_tells_nobody_and_quiet_hours_are_never_announced() -> None:
    assert told("move", [change()], NOW)[1:] == [
        ("Discord", "No post; a move is a new plan."),
        ("Phones", "No push; a move is a new plan."),
    ]
    assert told("delay", [change(kind="quiet_hours")], NOW) == [
        ("Screens", "Every screen, within a second, with a notice."),
        ("Discord", "No post."),
        ("Phones", "Nothing; quiet hours are never announced."),
    ]


def test_a_quiet_delay_tells_nobody_but_its_sessions_follow() -> None:
    assert told("delay", [change(title="Semis", managed=True)], NOW, announce=False) == [
        ("Screens", "Every screen, within a second."),
        ("Discord", "No post."),
        ("Phones", "No push, and a reminder that has gone out does not go out again."),
        ("Tournament", "Its sessions follow (Semis)."),
    ]


def test_moved_lines_read_in_the_events_time_zone() -> None:
    ends = NOW + timedelta(hours=1)
    row = {"title": "Semis", "starts_at": NOW, "ends_at": ends}
    later = NOW + timedelta(minutes=15)
    assert moved_line(row, later, ends + timedelta(minutes=15), TZ) == "Semis 19:00 → 19:15"
    # A running item keeps its start; only its end moves.
    assert moved_line(row, NOW, ends + timedelta(minutes=15), TZ) == (
        "Semis ends 20:15 instead of 20:00"
    )
    moment = {**row, "ends_at": None}
    assert moved_line(moment, NOW + timedelta(hours=6), None, TZ) == (
        "Semis 19:00 → Sat 21 Nov 01:00"
    )


def test_a_move_says_when_an_end_is_added_or_removed() -> None:
    row = {"title": "Doors", "starts_at": NOW, "ends_at": None}
    assert moved_line(row, NOW, NOW + timedelta(hours=1), TZ) == "Doors now ends 20:00"
    timed = {**row, "ends_at": NOW + timedelta(hours=1)}
    assert moved_line(timed, NOW, None, TZ) == "Doors no longer has an end"
    later = NOW + timedelta(minutes=30)
    assert moved_line(timed, later, None, TZ) == "Doors 19:00 → 19:30, with no end"
    assert moved_line(row, later, later + timedelta(hours=1), TZ) == (
        "Doors 19:00 → 19:30, until 20:30"
    )
