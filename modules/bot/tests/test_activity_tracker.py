"""The activity tracker, a port of the legacy `game_detector`'s count: "playing" activities only,
grouped by name the way the legacy grouped them, with the application id most players carry;
bots, offline members and people who hid not counted."""

from __future__ import annotations

from typing import Any

from canccu_bot.activity_tracker import ActivityTracker


def playing(uid: str, *activities: dict[str, Any], status: str = "online") -> dict[str, Any]:
    return {"user": {"id": uid}, "status": status, "activities": list(activities)}


def game(name: str, app: str | None = None, kind: int = 0) -> dict[str, Any]:
    out: dict[str, Any] = {"name": name, "type": kind}
    if app is not None:
        out["application_id"] = app
    return out


def test_players_are_counted_per_game() -> None:
    t = ActivityTracker()
    t.presence(playing("1", game("Demo Quest", "700")))
    t.presence(playing("2", game("Demo Quest", "700")))
    t.presence(playing("3", game("Block Builder")))
    assert t.count(frozenset(), frozenset()) == [
        {"application_id": "700", "name": "Demo Quest", "players": 2},
        {"application_id": None, "name": "Block Builder", "players": 1},
    ]


def test_only_playing_counts() -> None:
    t = ActivityTracker()
    t.presence(playing("1", game("Spotify", kind=2), game("Custom Status", kind=4)))
    assert t.count(frozenset(), frozenset()) == []


def test_names_group_by_case_and_spacing_and_the_most_common_wins() -> None:
    t = ActivityTracker()
    t.presence(playing("1", game("demo quest", "700")))
    t.presence(playing("2", game(" Demo  Quest ", "700")))
    t.presence(playing("3", game("Demo Quest")))
    t.presence(playing("4", game("Demo Quest", "701")))
    t.presence(playing("5", game("Demo Quest", "700")))
    [only] = t.count(frozenset(), frozenset())
    assert only == {"application_id": "700", "name": "Demo Quest", "players": 5}


def test_a_new_presence_replaces_the_old_activities_and_offline_clears_them() -> None:
    t = ActivityTracker()
    t.presence(playing("1", game("Demo Quest")))
    t.presence(playing("1", game("Block Builder")))
    assert [a["name"] for a in t.count(frozenset(), frozenset())] == ["Block Builder"]
    t.presence(playing("1", game("Block Builder"), status="offline"))
    assert t.count(frozenset(), frozenset()) == []


def test_bots_and_hidden_people_are_not_counted() -> None:
    t = ActivityTracker()
    for uid in ("1", "2", "3"):
        t.presence(playing(uid, game("Demo Quest")))
    [only] = t.count(frozenset({"2"}), frozenset({"3"}))
    assert only["players"] == 1


def test_a_guild_snapshot_replaces_everyone() -> None:
    t = ActivityTracker()
    t.presence(playing("1", game("Demo Quest")))
    t.guild({"presences": [playing("2", game("Block Builder"))]})
    assert t.count(frozenset(), frozenset()) == [
        {"application_id": None, "name": "Block Builder", "players": 1}
    ]
