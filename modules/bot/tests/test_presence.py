"""The presence tracker (port of the legacy `presence_tracker`): who is online, idle or on do not
disturb, and how many members the guild has, counted from the live state minus the people who hid
and minus bots, never stored per person on Postgres."""

from __future__ import annotations

from fakes import MemoryLive

from canccu_bot.presence import MembersTracker, PresenceTracker

T = "ev-a"
GUILD = "100000000000000001"


def presence(user: str, status: str, *activities: dict[str, object]) -> dict[str, object]:
    return {
        "user": {"id": user},
        "guild_id": GUILD,
        "status": status,
        "activities": list(activities),
    }


def member(user: str, *, bot: bool = False) -> dict[str, object]:
    return {"user": {"id": user, "username": f"name-{user}", "bot": bot}}


async def test_counts_by_status_and_skips_offline() -> None:
    tracker = PresenceTracker(MemoryLive(), T)
    await tracker.load(
        [
            presence("1", "online"),
            presence("2", "idle"),
            presence("3", "dnd"),
            presence("4", "online"),
        ]
    )
    await tracker.update(presence("5", "offline"))

    count = await tracker.count(frozenset(), frozenset())

    assert (count.online, count.idle, count.dnd) == (2, 1, 1)


async def test_an_update_moves_a_member_between_statuses_and_offline_drops_them() -> None:
    live = MemoryLive()
    tracker = PresenceTracker(live, T)
    await tracker.load([presence("1", "online"), presence("2", "online")])

    await tracker.update(presence("1", "idle"))
    await tracker.update(presence("2", "offline"))

    count = await tracker.count(frozenset(), frozenset())
    assert (count.online, count.idle, count.dnd) == (0, 1, 0)
    assert "2" not in await live.hgetall(f"bot:live:{T}:presence")


async def test_bots_and_hidden_people_are_never_counted() -> None:
    tracker = PresenceTracker(MemoryLive(), T)
    await tracker.load([presence("1", "online"), presence("2", "online"), presence("3", "online")])

    count = await tracker.count(frozenset({"2"}), frozenset({"3"}))

    assert count.online == 1


async def test_a_new_snapshot_replaces_the_old_state() -> None:
    """After a reconnect without resume GUILD_CREATE is the truth: someone who went offline while
    the bot was away is not left online."""
    tracker = PresenceTracker(MemoryLive(), T)
    await tracker.load([presence("1", "online"), presence("2", "online")])

    await tracker.load([presence("2", "idle")])

    count = await tracker.count(frozenset(), frozenset())
    assert (count.online, count.idle) == (0, 1)


async def test_the_live_state_keeps_no_name() -> None:
    live = MemoryLive()
    tracker = PresenceTracker(live, T)
    data = presence("1", "online", {"type": 0, "name": "Racing League", "application_id": "77"})
    data["user"] = {"id": "1", "username": "secret-name", "global_name": "Secret"}

    await tracker.update(data)

    stored = repr(live.values)
    assert "secret-name" not in stored and "Secret" not in stored


async def test_the_state_survives_a_new_tracker_on_the_same_store() -> None:
    """A restart: the next container reads the same Valkey."""
    live = MemoryLive()
    await PresenceTracker(live, T).load([presence("1", "online"), presence("2", "dnd")])

    count = await PresenceTracker(live, T).count(frozenset(), frozenset())

    assert (count.online, count.dnd) == (1, 1)


async def test_members_count_the_guild_minus_bots_and_hidden_people() -> None:
    tracker = MembersTracker(MemoryLive(), T)
    await tracker.load(
        {"member_count": 5, "members": [member("1"), member("2"), member("9", bot=True)]},
        with_members=True,
    )

    assert await tracker.count(frozenset()) == 4
    assert await tracker.count(frozenset({"2"})) == 3
    assert await tracker.bots() == frozenset({"9"})


async def test_members_follow_joins_and_leaves() -> None:
    tracker = MembersTracker(MemoryLive(), T)
    await tracker.load(
        {"member_count": 2, "members": [member("1"), member("2")]}, with_members=True
    )

    await tracker.added(member("3"))
    await tracker.added(member("8", bot=True))
    await tracker.removed({"user": {"id": "1"}})
    await tracker.removed({"user": {"id": "8"}})

    assert await tracker.count(frozenset()) == 2
    assert await tracker.bots() == frozenset()


async def test_without_the_members_feed_the_guild_count_stands_alone() -> None:
    """`bot.members` off: no member list is read, so bots cannot be told apart."""
    live = MemoryLive()
    tracker = MembersTracker(live, T)
    await tracker.load(
        {"member_count": 3, "members": [member("1"), member("9", bot=True)]}, with_members=False
    )

    assert await tracker.count(frozenset()) == 3
    assert f"bot:live:{T}:members" not in live.values


async def test_loading_members_keeps_the_guild_id_the_channel_cache_wrote() -> None:
    live = MemoryLive()
    await live.hset(f"bot:live:{T}:guild", "guild_id", GUILD)

    await MembersTracker(live, T).load({"member_count": 1, "members": []}, with_members=True)

    assert (await live.hgetall(f"bot:live:{T}:guild"))["guild_id"] == GUILD
