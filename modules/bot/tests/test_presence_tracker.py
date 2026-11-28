"""The presence tracker, a port of the legacy `presence_tracker`: members online, idle and do not
disturb, bots never counted, offline not counted; plus the guild's member count (D7)."""

from __future__ import annotations

from typing import Any

from canccu_bot.presence_tracker import PresenceTracker


def member(uid: str, *, bot: bool = False) -> dict[str, Any]:
    return {"user": {"id": uid, "bot": bot} if bot else {"id": uid}}


def presence(uid: str, status: str) -> dict[str, Any]:
    return {"user": {"id": uid}, "status": status, "activities": []}


def guild(members: list[dict[str, Any]], presences: list[dict[str, Any]], count: int) -> Any:
    return {"id": "g", "member_count": count, "members": members, "presences": presences}


def test_counts_each_status_and_skips_bots_and_offline() -> None:
    t = PresenceTracker()
    t.guild(
        guild(
            [member("1"), member("2"), member("3"), member("4"), member("9", bot=True)],
            [
                presence("1", "online"),
                presence("2", "idle"),
                presence("3", "dnd"),
                presence("9", "online"),
            ],
            5,
        )
    )
    assert t.count(frozenset()) == {"members": 4, "online": 1, "idle": 1, "dnd": 1}


def test_a_presence_update_moves_a_member_and_offline_leaves_the_count() -> None:
    t = PresenceTracker()
    t.guild(guild([member("1"), member("2")], [presence("1", "online")], 2))
    t.presence(presence("2", "online"))
    assert t.count(frozenset())["online"] == 2
    t.presence(presence("1", "offline"))
    t.presence(presence("2", "idle"))
    assert t.count(frozenset()) == {"members": 2, "online": 0, "idle": 1, "dnd": 0}


def test_members_follow_joins_and_leaves() -> None:
    t = PresenceTracker()
    t.guild(guild([member("1")], [], 1))
    t.member("GUILD_MEMBER_ADD", {"guild_id": "g", **member("2")})
    t.member("GUILD_MEMBER_ADD", {"guild_id": "g", **member("8", bot=True)})
    assert t.count(frozenset())["members"] == 2
    t.presence(presence("2", "online"))
    t.member("GUILD_MEMBER_REMOVE", {"guild_id": "g", "user": {"id": "2"}})
    assert t.count(frozenset()) == {"members": 1, "online": 0, "idle": 0, "dnd": 0}


def test_a_large_guild_counts_members_it_was_not_sent() -> None:
    """Discord sends a large guild's online members only; its member count holds the rest."""
    t = PresenceTracker()
    t.guild(guild([member("1"), member("9", bot=True)], [presence("1", "online")], 2000))
    assert t.count(frozenset())["members"] == 1999


def test_a_members_chunk_adds_members() -> None:
    t = PresenceTracker()
    t.guild(guild([], [], 0))
    t.member("GUILD_MEMBERS_CHUNK", {"guild_id": "g", "members": [member("1"), member("2")]})
    assert t.count(frozenset())["members"] == 2


def test_someone_hidden_is_not_counted() -> None:
    t = PresenceTracker()
    t.guild(guild([member("1"), member("2")], [presence("1", "dnd"), presence("2", "dnd")], 2))
    assert t.count(frozenset({"2"})) == {"members": 1, "online": 0, "idle": 0, "dnd": 1}


def test_the_state_round_trips_through_its_slices() -> None:
    """What a restart reads back from Valkey counts the same."""
    t = PresenceTracker()
    t.guild(guild([member("1"), member("9", bot=True)], [presence("1", "idle")], 40))
    copy = PresenceTracker()
    for mine, theirs in zip(t.slices().values(), copy.slices().values(), strict=True):
        theirs.load(dict(mine.values))
    assert copy.count(frozenset()) == t.count(frozenset())
