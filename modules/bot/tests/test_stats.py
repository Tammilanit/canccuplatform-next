"""`GET /api/bot/stats` (D7): the hourly series and the top games by player-hours, counts only,
so a member of the event reads it, and a guest as the info-page mode allows."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from conftest import NOW, Env

HOUR = NOW.replace(minute=0)


async def hour(env: Env, at: datetime, online: float | None, messages: int | None) -> None:
    await env.sql(
        "ev-a",
        "INSERT INTO bot_counts_hour (hour, minutes, members, online, online_max, idle, dnd,"
        " in_voice, in_voice_max, messages) VALUES ($1, 60, 10, $2, 3, 1, 0, 1.5, 2, $3)",
        at,
        online,
        messages,
    )


async def played(env: Env, at: datetime, name: str, app: str | None, minutes: int) -> None:
    await env.sql(
        "ev-a",
        "INSERT INTO bot_activity_hour (hour, name, application_id, player_minutes,"
        " peak_players) VALUES ($1, $2, $3, $4, 2)",
        at,
        name,
        app,
        minutes,
    )


def catalogue(games: list[dict[str, Any]]) -> Any:
    async def read(tenant: str) -> list[dict[str, Any]]:
        return games

    return read


GAMES = [
    {
        "id": "g1",
        "name": "Demo Quest",
        "status": "active",
        "discord": {"application_ids": ["700"], "name_aliases": ["Demo Quest"]},
    },
    {
        "id": "g2",
        "name": "Block Builder",
        "status": "active",
        "discord": {"application_ids": [], "name_aliases": ["Block Builder"]},
    },
]


async def test_the_hourly_series_for_a_guest(env: Env) -> None:
    await hour(env, HOUR - timedelta(hours=2), 2.25, 40)
    await hour(env, HOUR - timedelta(hours=1), None, 7)
    await hour(env, HOUR - timedelta(hours=30), 9, 9)  # outside the default 24 hours
    async with env.client() as c:
        r = await c.get("/api/bot/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["hours"] == [
        {
            "hour": "2026-11-27T08:00:00Z",
            "online": 2.25,
            "online_max": 3,
            "in_voice": 1.5,
            "messages": 40,
        },
        {
            "hour": "2026-11-27T09:00:00Z",
            "online": None,
            "online_max": 3,
            "in_voice": 1.5,
            "messages": 7,
        },
    ]
    assert body["top_games"] == []


async def test_hours_reach_back_at_most_72(env: Env) -> None:
    await hour(env, HOUR - timedelta(hours=30), 9, 9)
    async with env.client() as c:
        r = await c.get("/api/bot/stats", params={"hours": 48})
        assert [h["hour"] for h in r.json()["hours"]] == ["2026-11-26T04:00:00Z"]
        for bad in ("0", "73", "x", "\u00b2"):  # "²" is a digit to isdigit(), not to int()
            r = await c.get("/api/bot/stats", params={"hours": bad})
            assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_request"


async def test_top_games_by_player_hours_from_the_catalogue_only(env: Env) -> None:
    env.deps.catalogue = catalogue(GAMES)
    at = HOUR - timedelta(hours=1)
    await played(env, at, "Demo Quest", "700", 90)
    await played(env, at - timedelta(hours=1), "DQ renamed", "700", 30)
    await played(env, at, "Block Builder", None, 150)
    await played(env, at, "Someone's Free Text", None, 600)  # matches nothing: never listed
    async with env.client() as c:
        body = (await c.get("/api/bot/stats")).json()
    assert body["top_games"] == [
        {"game_id": "g2", "name": "Block Builder", "player_hours": 2.5},
        {"game_id": "g1", "name": "Demo Quest", "player_hours": 2.0},
    ]


async def test_a_platform_hostname_names_no_event(env: Env) -> None:
    async with env.client("signin.example.test") as c:
        r = await c.get("/api/bot/stats")
    assert r.status_code == 404


async def test_a_guest_reads_only_as_the_info_page_mode_allows(env: Env) -> None:
    """contracts/tenants.md, Info pages: a draft event gives guests nothing, `sign_in` lets no
    guest in, `venue_only` only from the venue's addresses; a member reads in every mode."""
    ctx = env.contexts["ev-a"]
    member = env.rights.sign_in("u_member")

    async def status(headers: dict[str, str] | None = None) -> tuple[int, str | None]:
        async with env.client() as c:
            r = await c.get("/api/bot/stats", headers=headers or {})
        return r.status_code, r.json().get("error", {}).get("code")

    closed = (403, "info_pages_closed")
    ctx["status"] = "draft"
    assert await status() == closed
    assert (await status(member))[0] == 200
    ctx["status"], ctx["info_page_mode"] = "live", "sign_in"
    assert await status() == closed
    assert (await status(member))[0] == 200
    ctx["info_page_mode"] = "venue_only"
    assert await status() == closed  # the test client is 198.51.100.7, off the venue
    ctx["venue"] = {"id": "v1", "name": "Hall", "addresses": ["198.51.100.0/24"]}
    assert (await status())[0] == 200
