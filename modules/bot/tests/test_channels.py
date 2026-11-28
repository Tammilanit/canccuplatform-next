"""The guild's channels as the counts need them: which ones everyone can read (chat activity, D6 B)
and which voice rooms everyone can see (D8), computed the way Discord computes @everyone's View
channel."""

from __future__ import annotations

from typing import Any

from fakes import MemoryLive

from canccu_bot.channels import ChannelCache

T = "ev-a"
GUILD = "100000000000000001"
VIEW = 1 << 10


def channel(
    cid: str, *, kind: int = 0, deny: int = 0, allow: int = 0, **more: object
) -> dict[str, Any]:
    overwrites = [{"id": GUILD, "type": 0, "allow": str(allow), "deny": str(deny)}]
    return {
        "id": cid,
        "type": kind,
        "name": f"room-{cid}",
        "permission_overwrites": overwrites,
        **more,
    }


def guild(
    *channels: dict[str, Any], everyone: int = VIEW, threads: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    return {
        "id": GUILD,
        "roles": [{"id": GUILD, "permissions": str(everyone)}],
        "channels": list(channels),
        "threads": threads or [],
    }


async def test_a_channel_everyone_can_view_is_public_and_one_denied_is_not() -> None:
    cache = ChannelCache(MemoryLive(), T)
    await cache.load(guild(channel("10"), channel("11", deny=VIEW)))

    view = await cache.view()

    assert view.public("10") and not view.public("11")


async def test_an_overwrite_can_open_a_channel_the_server_closes() -> None:
    cache = ChannelCache(MemoryLive(), T)
    await cache.load(guild(channel("10"), channel("11", allow=VIEW), everyone=0))

    view = await cache.view()

    assert not view.public("10") and view.public("11")


async def test_threads_follow_their_parent_and_private_threads_never_count() -> None:
    cache = ChannelCache(MemoryLive(), T)
    threads = [
        {"id": "20", "type": 11, "parent_id": "10"},
        {"id": "21", "type": 11, "parent_id": "11"},
        {"id": "22", "type": 12, "parent_id": "10"},
    ]
    await cache.load(guild(channel("10"), channel("11", deny=VIEW), threads=threads))

    view = await cache.view()

    assert view.public("20") and not view.public("21") and not view.public("22")


async def test_an_unknown_channel_is_not_public() -> None:
    cache = ChannelCache(MemoryLive(), T)
    await cache.load(guild(channel("10")))

    assert not (await cache.view()).public("99")


async def test_channel_updates_and_deletes_reach_the_view() -> None:
    cache = ChannelCache(MemoryLive(), T)
    await cache.load(guild(channel("10"), channel("11")))

    await cache.upsert(channel("10", deny=VIEW))
    await cache.upsert(channel("12", kind=2))
    await cache.remove("11")

    view = await cache.view()
    assert not view.public("10") and not view.public("11") and view.public("12")
    assert view.voice_rooms() == {"12": "room-12"}


async def test_a_change_of_the_everyone_role_reaches_every_channel() -> None:
    cache = ChannelCache(MemoryLive(), T)
    await cache.load(guild(channel("10")))

    await cache.role_changed(GUILD, {"id": GUILD, "permissions": "0"})

    assert not (await cache.view()).public("10")


async def test_voice_rooms_are_the_public_voice_and_stage_channels() -> None:
    cache = ChannelCache(MemoryLive(), T)
    await cache.load(
        guild(
            channel("10"),
            channel("30", kind=2),
            channel("31", kind=2, deny=VIEW),
            channel("32", kind=13),
        )
    )

    assert (await cache.view()).voice_rooms() == {"30": "room-30", "32": "room-32"}
