"""The feeds' handlers: GUILD_CREATE's snapshot and each feed's events reach the trackers, each part
only under its flag, and a member who leaves leaves the live state."""

from __future__ import annotations

from typing import Any

from canccu_kit import tenant_scope
from canccu_kit.access import TenantContext
from conftest import context
from fakes import MemoryLive

from canccu_bot.feeds import Feeds
from canccu_bot.live import live_key

T = "ev-a"
GUILD = "100000000000000001"
VIEW = 1 << 10
ON = {"bot.presence": True, "bot.members": True, "bot.voice": True, "bot.messages": True}


def snapshot() -> dict[str, Any]:
    return {
        "id": GUILD,
        "member_count": 4,
        "roles": [{"id": GUILD, "permissions": str(VIEW)}],
        "channels": [
            {"id": "10", "type": 0, "name": "general"},
            {"id": "30", "type": 2, "name": "Lounge"},
        ],
        "members": [
            {"user": {"id": "1"}},
            {"user": {"id": "2"}},
            {"user": {"id": "3"}},
            {"user": {"id": "9", "bot": True}},
        ],
        "presences": [
            {"user": {"id": "1"}, "status": "online", "activities": []},
            {"user": {"id": "2"}, "status": "idle", "activities": []},
            {"user": {"id": "9"}, "status": "online", "activities": []},
        ],
        "voice_states": [{"user_id": "1", "channel_id": "30"}],
    }


class Setup:
    def __init__(self, flags: dict[str, bool]) -> None:
        self.live = MemoryLive()
        self.ctx: TenantContext = context(T)
        self.ctx["flags"] = dict(flags)

        async def ctx_of(tenant: str) -> TenantContext | None:
            return self.ctx if tenant == T else None

        async def hidden(tenant: str) -> frozenset[str]:
            return frozenset()

        self.feeds = Feeds(self.live, ctx_of, hidden)

    async def guild(self, event: str, data: dict[str, Any]) -> None:
        with tenant_scope(T):
            await self.feeds.guild(event, data)

    async def feed(self, event: str, data: dict[str, Any]) -> None:
        with tenant_scope(T):
            await self.feeds.feed(event, data)


async def test_the_snapshot_fills_every_part_and_names_the_guild_served() -> None:
    s = Setup(ON)
    await s.guild("GUILD_CREATE", snapshot())

    snap = await s.feeds.snapshot(T, ON)

    assert (snap.members, snap.online, snap.idle, snap.in_voice) == (3, 1, 1, 1)
    assert snap.rooms == [{"channel_id": "30", "name": "Lounge", "member_count": 1}]
    assert s.feeds.served == {T: GUILD}


async def test_a_part_whose_flag_is_off_is_not_kept() -> None:
    s = Setup(ON)
    await s.guild("GUILD_CREATE", snapshot())
    s.ctx["flags"] = {**ON, "bot.presence": False, "bot.voice": False}

    await s.guild("GUILD_CREATE", snapshot())

    assert live_key(T, "presence") not in s.live.values
    assert live_key(T, "voice") not in s.live.values


async def test_a_member_who_leaves_leaves_presence_and_voice() -> None:
    s = Setup(ON)
    await s.guild("GUILD_CREATE", snapshot())

    await s.feed("GUILD_MEMBER_REMOVE", {"guild_id": GUILD, "user": {"id": "1"}})

    snap = await s.feeds.snapshot(T, ON)
    assert (snap.members, snap.online, snap.in_voice) == (2, 0, 0)


async def test_feed_updates_reach_their_tracker() -> None:
    s = Setup(ON)
    await s.guild("GUILD_CREATE", snapshot())

    await s.feed("PRESENCE_UPDATE", {"guild_id": GUILD, "user": {"id": "3"}, "status": "dnd"})
    await s.feed("VOICE_STATE_UPDATE", {"guild_id": GUILD, "user_id": "2", "channel_id": "30"})
    await s.feed("GUILD_MEMBER_ADD", {"guild_id": GUILD, "user": {"id": "4"}})
    await s.guild("CHANNEL_UPDATE", {"guild_id": GUILD, "id": "30", "type": 2, "name": "Hall"})

    snap = await s.feeds.snapshot(T, ON)
    assert (snap.members, snap.dnd, snap.in_voice) == (4, 1, 2)
    assert snap.rooms == [{"channel_id": "30", "name": "Hall", "member_count": 2}]


async def test_a_message_in_a_public_channel_is_counted() -> None:
    s = Setup(ON)
    await s.guild("GUILD_CREATE", snapshot())

    await s.feed(
        "MESSAGE_CREATE",
        {"guild_id": GUILD, "channel_id": "10", "type": 0, "author": {"id": "1"}},
    )

    assert sum(int(v) for k, v in s.live.values.items() if ":messages:" in k) == 1
