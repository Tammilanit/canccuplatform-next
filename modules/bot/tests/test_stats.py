"""`GET /api/bot/stats` (contracts/bot.md, Counts): the hourly series and the top games by
player-hours, counts only, so anyone the event's info pages let in may read them."""

from __future__ import annotations

import json
from datetime import timedelta

from conftest import NOW, Env

T = "ev-a"
LATER = NOW + timedelta(minutes=30)
HOUR = NOW.replace(minute=0, second=0, microsecond=0)


async def hour_row(env: Env, tenant: str, back: int, online: float, messages: int | None) -> None:
    await env.sql(
        tenant,
        "INSERT INTO bot_counts_hour (hour, minutes, members, online, idle, dnd, in_voice,"
        " online_peak, in_voice_peak, messages) VALUES ($1, 60, 10, $2, 1, 0, 2, 7, 3, $3)",
        HOUR - timedelta(hours=back),
        online,
        messages,
    )


async def game(env: Env, back: int, app: str | None, name: str, minutes: int) -> None:
    key = f"app:{app}" if app else f"name:{name.lower()}"
    await env.sql(
        T,
        "INSERT INTO bot_activity_hour (hour, activity_key, application_id, name, player_minutes)"
        " VALUES ($1, $2, $3, $4, $5)",
        HOUR - timedelta(hours=back),
        key,
        app,
        name,
        minutes,
    )


async def minute_row(env: Env, back_minutes: int, online: int, messages: int) -> None:
    activities = json.dumps([{"application_id": "77", "name": "Racing League", "players": 2}])
    await env.sql(
        T,
        "INSERT INTO bot_counts_minute (minute, members, online, idle, dnd, in_voice, messages,"
        " activities) VALUES ($1, 10, $2, 0, 0, 1, $3, $4::jsonb)",
        LATER - timedelta(minutes=back_minutes),
        online,
        messages,
        activities,
    )


async def test_a_guest_reads_the_hourly_series_and_the_top_games(env: Env) -> None:
    env.deps.now = lambda: LATER
    await hour_row(env, T, 2, 4.5, 12)
    await hour_row(env, T, 1, 6, None)
    await hour_row(env, "ev-b", 1, 99, 99)  # another event's counts never show
    await game(env, 2, "77", "Racing League", 90)
    await game(env, 1, "88", "Blocks", 30)
    await game(env, 1, None, "Typed By Someone", 60)
    await minute_row(env, 2, 8, 3)  # this hour, not folded yet: folded on the fly
    await minute_row(env, 1, 6, 1)

    async with env.client() as http:
        response = await http.get("/api/bot/stats", params={"hours": 3})

    assert response.status_code == 200
    body = response.json()
    assert [h["hour"] for h in body["hours"]] == [
        "2026-11-27T08:00:00Z",
        "2026-11-27T09:00:00Z",
        "2026-11-27T10:00:00Z",
    ]
    assert body["hours"][0] == {
        "hour": "2026-11-27T08:00:00Z",
        "members": 10,
        "online": 4.5,
        "idle": 1,
        "dnd": 0,
        "in_voice": 2,
        "online_peak": 7,
        "in_voice_peak": 3,
        "messages": 12,
    }
    assert body["hours"][1]["messages"] is None
    assert (body["hours"][2]["online"], body["hours"][2]["messages"]) == (7, 4)
    assert body["top_games"] == [
        {"application_id": "77", "name": "Racing League", "player_hours": 1.57},
        {"application_id": None, "name": None, "player_hours": 1.0},
        {"application_id": "88", "name": "Blocks", "player_hours": 0.5},
    ]
    assert body["as_of"] == "2026-11-27T10:30:00Z"


async def test_hours_outside_the_window_are_left_out(env: Env) -> None:
    await hour_row(env, T, 5, 1, 1)

    async with env.client() as http:
        body = (await http.get("/api/bot/stats", params={"hours": 2})).json()

    assert body == {"hours": [], "top_games": [], "as_of": None}


async def test_the_window_is_one_to_72_hours(env: Env) -> None:
    async with env.client() as http:
        for bad in ("0", "73", "x"):
            response = await http.get("/api/bot/stats", params={"hours": bad})
            assert response.status_code == 400
            assert response.json()["error"]["code"] == "invalid_request"
        assert (await http.get("/api/bot/stats")).status_code == 200


async def test_an_event_whose_info_pages_need_sign_in_shuts_out_guests(env: Env) -> None:
    env.contexts[T]["info_page_mode"] = "sign_in"

    async with env.client() as http:
        guest = await http.get("/api/bot/stats")
        member = await http.get("/api/bot/stats", headers=env.rights.sign_in("u_1"))

    assert guest.status_code in (401, 403)
    assert member.status_code == 200
