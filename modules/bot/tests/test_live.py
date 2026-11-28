"""The live state of one event's guild (D2): kept in memory, written behind to Valkey, read back
after a restart, cleared per feed when its flag goes off, and gone at archiving."""

from __future__ import annotations

from typing import Any

from fakes import MemoryKeys

from canccu_bot.live import GuildLive, live_keys

GUILD = "g"


def snapshot() -> dict[str, Any]:
    return {
        "id": GUILD,
        "member_count": 3,
        "roles": [{"id": GUILD, "permissions": str(1 << 10)}],
        "channels": [{"id": "v1", "type": 2, "name": "Lobby", "permission_overwrites": []}],
        "members": [{"user": {"id": "1"}}, {"user": {"id": "2"}}, {"user": {"id": "3"}}],
        "presences": [
            {
                "user": {"id": "1"},
                "status": "online",
                "activities": [{"name": "Demo Quest", "type": 0}],
            },
            {"user": {"id": "2"}, "status": "idle", "activities": []},
        ],
        "voice_states": [{"user_id": "1", "channel_id": "v1"}],
    }


def counted(live: GuildLive) -> Any:
    none: frozenset[str] = frozenset()
    return live.snapshot(none)


async def test_a_restart_reads_the_same_state_back() -> None:
    keys = MemoryKeys()
    live = GuildLive("ev-a")
    live.apply("GUILD_CREATE", snapshot())
    live.apply("PRESENCE_UPDATE", {"user": {"id": "3"}, "status": "dnd", "activities": []})
    await live.flush(keys)
    again = GuildLive("ev-a")
    await again.load(keys)
    assert counted(again) == counted(live)
    assert counted(again)["online"] == 1 and counted(again)["rooms"] == [
        {"channel_id": "v1", "name": "Lobby", "member_count": 1}
    ]
    assert again.guild_id == GUILD


async def test_a_flush_writes_what_changed_and_removes_what_left() -> None:
    keys = MemoryKeys()
    live = GuildLive("ev-a")
    live.apply("GUILD_CREATE", snapshot())
    await live.flush(keys)
    live.apply("VOICE_STATE_UPDATE", {"user_id": "1", "channel_id": None})
    await live.flush(keys)
    again = GuildLive("ev-a")
    await again.load(keys)
    assert counted(again)["in_voice"] == 0


async def test_each_feed_is_cleared_on_its_own() -> None:
    live = GuildLive("ev-a")
    live.apply("GUILD_CREATE", snapshot())
    live.clear("bot.voice")
    assert counted(live)["in_voice"] == 0 and counted(live)["online"] == 1
    live.clear("bot.presence")
    assert counted(live)["online"] == 0 and counted(live)["activities"] == []


async def test_drop_removes_every_key_of_the_event() -> None:
    keys = MemoryKeys()
    live = GuildLive("ev-a")
    live.apply("GUILD_CREATE", snapshot())
    await live.flush(keys)
    assert any(k.startswith("bot:live:ev-a:") for k in keys.values)
    await live.drop(keys)
    assert not any(k.startswith("bot:live:ev-a:") for k in keys.values)
    assert all(k.startswith("bot:live:ev-a:") for k in live_keys("ev-a"))


async def test_nothing_of_a_person_but_their_discord_id_is_kept() -> None:
    """No name, nick or avatar: only ids and what the counts need."""
    keys = MemoryKeys()
    live = GuildLive("ev-a")
    data = snapshot()
    data["members"][0] = {"user": {"id": "1", "username": "secret-name"}, "nick": "secret-nick"}
    live.apply("GUILD_CREATE", data)
    await live.flush(keys)
    assert "secret" not in repr(keys.values)


async def test_a_failed_write_keeps_what_it_did_not_write() -> None:
    """A Valkey error or a cancel mid-flush loses no delta: the next flush writes it."""
    keys = MemoryKeys()
    live = GuildLive("ev-a")
    live.apply("GUILD_CREATE", snapshot())
    await live.flush(keys)
    live.apply("PRESENCE_UPDATE", {"user": {"id": "3"}, "status": "dnd", "activities": []})
    live.apply("VOICE_STATE_UPDATE", {"user_id": "1", "channel_id": None})
    real = keys.hash_write

    async def down(key: str, *args: Any) -> None:
        if key.endswith(":presence"):  # the slice that holds a delta
            raise ConnectionError("valkey went away")
        await real(key, *args)

    keys.hash_write = down  # type: ignore[method-assign,assignment]
    try:
        await live.flush(keys)
    except ConnectionError:
        pass
    keys.hash_write = real  # type: ignore[method-assign]
    await live.flush(keys)
    again = GuildLive("ev-a")
    await again.load(keys)
    assert counted(again) == counted(live)
    assert counted(again)["dnd"] == 1 and counted(again)["in_voice"] == 0
