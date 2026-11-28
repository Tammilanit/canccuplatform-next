"""The voice tracker, a port of the legacy `voice_tracker`: people in voice, bots never counted;
rooms listed by name only when everyone in the guild can see them (D8)."""

from __future__ import annotations

from typing import Any

from canccu_bot.voice_tracker import VoiceTracker

ROOMS = {"v1": "Lobby", "v2": "Games"}


def state(uid: str, channel: str | None, *, bot: bool = False) -> dict[str, Any]:
    user: dict[str, Any] = {"id": uid, "bot": True} if bot else {"id": uid}
    return {"guild_id": "g", "user_id": uid, "channel_id": channel, "member": {"user": user}}


def test_people_in_voice_and_the_public_rooms() -> None:
    t = VoiceTracker()
    t.guild({"voice_states": [state("1", "v1"), state("2", "v1"), state("3", "v2")]})
    t.update(state("4", "private"))
    in_voice, rooms = t.count(frozenset(), frozenset(), ROOMS)
    assert in_voice == 4
    assert rooms == [
        {"channel_id": "v1", "name": "Lobby", "member_count": 2},
        {"channel_id": "v2", "name": "Games", "member_count": 1},
    ]


def test_leaving_and_moving() -> None:
    t = VoiceTracker()
    t.update(state("1", "v1"))
    t.update(state("2", "v1"))
    t.update(state("1", "v2"))
    t.update(state("2", None))
    assert t.count(frozenset(), frozenset(), ROOMS) == (
        1,
        [{"channel_id": "v2", "name": "Games", "member_count": 1}],
    )


def test_bots_and_hidden_people_are_not_counted() -> None:
    t = VoiceTracker()
    t.update(state("1", "v1"))
    t.update(state("8", "v1", bot=True))
    t.update(state("2", "v1"))
    t.update(state("3", "v1"))
    assert t.count(frozenset({"2"}), frozenset({"3"}), ROOMS) == (
        1,
        [{"channel_id": "v1", "name": "Lobby", "member_count": 1}],
    )


def test_an_empty_room_is_not_listed() -> None:
    t = VoiceTracker()
    t.update(state("1", "v1"))
    t.update(state("1", None))
    assert t.count(frozenset(), frozenset(), ROOMS) == (0, [])
