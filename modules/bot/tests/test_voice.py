"""The voice tracker (port of the legacy `voice_tracker`): who is in voice counted, and the public
rooms with people in them, by name and count only (D8)."""

from __future__ import annotations

from fakes import MemoryLive

from canccu_bot.channels import Channels
from canccu_bot.voice import VoiceTracker

T = "ev-a"
GUILD = "100000000000000001"
VIEW = 1 << 10


def state(user: str, channel: str | None) -> dict[str, object]:
    return {"guild_id": GUILD, "user_id": user, "channel_id": channel}


def channels() -> Channels:
    def voice(name: str, deny: int = 0) -> dict[str, object]:
        overwrite = {"id": GUILD, "type": 0, "allow": "0", "deny": str(deny)}
        return {"t": 2, "n": name, "p": None, "o": overwrite}

    return Channels(
        GUILD, VIEW, {"30": voice("Lounge"), "31": voice("Crew", VIEW), "32": voice("Quiet")}
    )


async def test_only_occupied_public_rooms_are_listed_busiest_first() -> None:
    tracker = VoiceTracker(MemoryLive(), T)
    await tracker.load([state("1", "30"), state("2", "32"), state("3", "32"), state("4", "31")])

    rooms, in_voice = await tracker.count(channels(), frozenset(), frozenset())

    assert rooms == [
        {"channel_id": "32", "name": "Quiet", "member_count": 2},
        {"channel_id": "30", "name": "Lounge", "member_count": 1},
    ]
    assert in_voice == 4  # a private room's people are counted, never listed


async def test_nobody_in_voice_gives_an_empty_list() -> None:
    tracker = VoiceTracker(MemoryLive(), T)

    rooms, in_voice = await tracker.count(channels(), frozenset(), frozenset())

    assert (rooms, in_voice) == ([], 0)


async def test_moves_and_leaving_voice_follow_the_updates() -> None:
    tracker = VoiceTracker(MemoryLive(), T)
    await tracker.load([state("1", "30"), state("2", "30")])

    await tracker.update(state("1", "32"))
    await tracker.update(state("2", None))

    rooms, in_voice = await tracker.count(channels(), frozenset(), frozenset())
    assert rooms == [{"channel_id": "32", "name": "Quiet", "member_count": 1}]
    assert in_voice == 1


async def test_bots_and_hidden_people_are_never_counted() -> None:
    tracker = VoiceTracker(MemoryLive(), T)
    await tracker.load([state("1", "30"), state("2", "30"), state("9", "30")])

    rooms, in_voice = await tracker.count(channels(), frozenset({"2"}), frozenset({"9"}))

    assert rooms == [{"channel_id": "30", "name": "Lounge", "member_count": 1}]
    assert in_voice == 1


async def test_a_snapshot_replaces_the_state_and_survives_a_new_tracker() -> None:
    live = MemoryLive()
    await VoiceTracker(live, T).load([state("1", "30")])
    await VoiceTracker(live, T).load([state("2", "32")])

    rooms, _ = await VoiceTracker(live, T).count(channels(), frozenset(), frozenset())

    assert rooms == [{"channel_id": "32", "name": "Quiet", "member_count": 1}]
