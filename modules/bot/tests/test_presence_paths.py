"""The module paths for Screen (contracts/bot.md, Who plays what: For the screens): per game and
per public voice room, counts only, from the live state in Valkey, for the screen module alone."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

import pytest
from canccu_kit import ServiceIdentity
from conftest import NOW, SHARED_ID, Env

from canccu_bot.live import GuildLive

KEY = b"k" * 32
GUILD = "300000000000000001"
FLAGS = {"bot.presence": True, "bot.voice": True, "bot.members": True, "bot.messages": True}


def snapshot() -> dict[str, Any]:
    def playing(uid: str, *activities: tuple[str, str | None]) -> dict[str, Any]:
        acts = [{"name": n, "type": 0, "application_id": a} for n, a in activities]
        return {"user": {"id": uid}, "status": "online", "activities": acts}

    return {
        "id": GUILD,
        "member_count": 6,
        "roles": [{"id": GUILD, "permissions": str(1 << 10)}],
        "channels": [
            {"id": "v1", "type": 2, "name": "Lobby", "permission_overwrites": []},
            {"id": "v2", "type": 2, "name": "Match 3 · Team A", "permission_overwrites": []},
            {
                "id": "v3",
                "type": 2,
                "name": "Crew room",
                "permission_overwrites": [{"id": GUILD, "allow": "0", "deny": str(1 << 10)}],
            },
        ],
        "members": [
            *({"user": {"id": u}} for u in ("1", "2", "3", "4", "5")),
            {"user": {"id": "9", "bot": True}},
        ],
        "presences": [
            # One person with two activities of one game counts once for it.
            playing("1", ("Demo Arena", "700"), ("demo arena ", None)),
            playing("2", ("Demo Arena", "700")),
            playing("3", ("Space Racer", None)),
            playing("4", ("Hidden Thing", "800"), ("Some free text", None)),
            playing("5", ("Another free text", None)),
            playing("9", ("Demo Arena", "700")),
        ],
        "voice_states": [
            {"user_id": "1", "channel_id": "v1"},
            {"user_id": "2", "channel_id": "v1"},
            {"user_id": "3", "channel_id": "v2"},
            {"user_id": "4", "channel_id": "v3"},
            {"user_id": "9", "channel_id": "v1", "member": {"user": {"id": "9", "bot": True}}},
        ],
    }


CATALOGUE = [
    {
        "id": "g_arena",
        "name": "Demo Arena",
        "status": "active",
        "discord": {"application_ids": ["700"], "name_aliases": ["Demo Arena"]},
    },
    {
        "id": "g_racer",
        "name": "Space Racer",
        "status": "active",
        "discord": {"application_ids": [], "name_aliases": ["Space Racer"]},
    },
    {
        "id": "g_hidden",
        "name": "Hidden Thing",
        "status": "hidden",
        "discord": {"application_ids": ["800"], "name_aliases": []},
    },
]


def screen(module: str = "screen") -> dict[str, str]:
    return ServiceIdentity(module, KEY).headers("bot")


async def serving(env: Env, *, status: str = "ready") -> None:
    """ev-a bound to GUILD on the shared client in `status`, with its live state written."""
    env.contexts["ev-a"]["flags"] = dict(FLAGS)
    await env.sql(
        "ev-a",
        "INSERT INTO bot_bindings (guild_id, guild_name, application_id) VALUES ($1, 'G', $2)",
        GUILD,
        SHARED_ID,
    )
    await env.deps.board.publish(
        SHARED_ID, {"status": status, "error_code": None, "since": ""}, None
    )
    live = GuildLive("ev-a")
    live.apply("GUILD_CREATE", snapshot())
    await live.flush(env.keys, NOW)


async def get(env: Env, path: str, tenant: str = "ev-a", module: str = "screen") -> Any:
    async with env.client("bot:8080") as c:
        return await c.get(
            f"/internal/bot/presence/{path}?tenant_id={tenant}", headers=screen(module)
        )


@pytest.fixture
def catalogue(env: Env) -> None:
    async def games(tenant: str) -> list[dict[str, Any]]:
        return CATALOGUE

    env.deps.catalogue = games


async def test_playing_counts_players_per_game_and_names_nobody(env: Env, catalogue: None) -> None:
    await serving(env)
    r = await get(env, "playing")
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "available": True,
        "as_of": "2026-11-27T10:00:00Z",
        "games": [
            {"game_id": "g_arena", "name": "Demo Arena", "player_count": 2},
            # Unmatched free text is one entry, never named; the hidden game's player is left out
            # of it entirely, but their other, unmatched activity still counts there.
            {"game_id": None, "name": None, "player_count": 2},
            {"game_id": "g_racer", "name": "Space Racer", "player_count": 1},
        ],
    }
    text = json.dumps(body)
    assert "free text" not in text and "Hidden Thing" not in text
    assert not any(uid in text for uid in ('"1"', '"2"', '"9"'))


async def test_without_the_catalogue_every_activity_is_unmatched(env: Env) -> None:
    await serving(env)
    body = (await get(env, "playing")).json()
    assert body["games"] == [{"game_id": None, "name": None, "player_count": 5}]


async def test_voice_lists_the_public_rooms_busiest_first(env: Env) -> None:
    await serving(env)
    body = (await get(env, "voice")).json()
    assert body == {
        "available": True,
        "as_of": "2026-11-27T10:00:00Z",
        "channels": [
            {"channel_id": "v1", "name": "Lobby", "member_count": 2},
            {"channel_id": "v2", "name": "Match 3 · Team A", "member_count": 1},
        ],
    }


async def test_who_hid_is_counted_nowhere(env: Env, catalogue: None) -> None:
    await serving(env)

    async def hidden(tenant: str) -> frozenset[str]:
        return frozenset({"1", "3"})

    env.deps.hidden = hidden
    playing = (await get(env, "playing")).json()["games"]
    assert {g["game_id"]: g["player_count"] for g in playing} == {"g_arena": 1, None: 2}
    voice = (await get(env, "voice")).json()["channels"]
    assert voice == [{"channel_id": "v1", "name": "Lobby", "member_count": 1}]


@pytest.mark.parametrize(("path", "flag"), [("playing", "bot.presence"), ("voice", "bot.voice")])
async def test_a_feed_flag_off_is_not_available(env: Env, path: str, flag: str) -> None:
    await serving(env)
    env.contexts["ev-a"]["flags"][flag] = False
    body = (await get(env, path)).json()
    key = "games" if path == "playing" else "channels"
    assert body == {"available": False, "as_of": None, key: []}


@pytest.mark.parametrize("path", ["playing", "voice"])
async def test_no_guild_bound_is_not_available(env: Env, path: str) -> None:
    env.contexts["ev-a"]["flags"] = dict(FLAGS)
    body = (await get(env, path)).json()
    assert body["available"] is False and body["as_of"] is None


@pytest.mark.parametrize("status", ["connecting", "paused", "failed"])
async def test_a_client_not_ready_is_not_available(env: Env, status: str) -> None:
    await serving(env, status=status)
    assert (await get(env, "voice")).json()["available"] is False


async def test_a_status_nobody_refreshes_is_not_available(env: Env) -> None:
    await serving(env)
    env.keys.now_ms += int(timedelta(minutes=2).total_seconds() * 1000)
    assert (await get(env, "playing")).json()["available"] is False


async def test_an_archived_event_is_not_available(env: Env) -> None:
    await serving(env)
    env.contexts["ev-a"]["status"] = "archived"
    assert (await get(env, "playing")).json()["available"] is False


async def test_only_the_screen_module_may_read(env: Env) -> None:
    await serving(env)
    assert (await get(env, "playing", module="moments")).status_code == 403
    async with env.client("bot:8080") as c:
        r = await c.get("/internal/bot/presence/voice?tenant_id=ev-a")
    assert r.status_code == 401


async def test_an_unknown_event_is_not_found(env: Env) -> None:
    assert (await get(env, "voice", tenant="ev-zz")).status_code == 404
