"""Events become notifications in the inbox, at most once, for the right people
(contracts/notify.md, Notifications and the inbox; Dedupe)."""

from __future__ import annotations

from typing import Any

from conftest import Env
from topics import play, reminder, schedule


async def inbox(env: Env, headers: dict[str, str], host: str = "a.example.test") -> list[Any]:
    async with env.client(host) as c:
        response = await c.get("/api/notify/inbox", headers=headers)
    assert response.status_code == 200, response.text
    notes: list[Any] = response.json()["notifications"]
    return notes


async def test_a_reminder_lands_once_in_the_events_time_zone(env: Env) -> None:
    await env.register(schedule())
    env.contexts["ev-a"]["time_zone"] = "Europe/Helsinki"
    h = env.rights.sign_in("u_a")
    assert await inbox(env, h) == []  # the request also stores the event's time zone
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())  # delivered twice
    [note] = await inbox(env, h)
    assert note["title"] == "Dinner at 20:00" and note["audience"] == "public"
    assert note["url"] == "/notify/agenda/it1" and note["expires_at"] == "2026-11-20T18:00:00Z"
    assert len(note["id"]) >= 16
    assert await inbox(env, h, host="b.example.test") == []


async def test_disabled_topics_and_crew_items_make_nothing(env: Env) -> None:
    await env.register(schedule())
    async with env.client() as c:
        await c.put(
            "/api/notify/topic-types/schedule/config",
            json={"config_version": 0, "enabled": False},
            headers=env.admin(),
        )
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(), id="e1")
    await env.emit("ev-b", "agenda.reminder.triggered", reminder("crew"), id="e2")
    h = env.rights.sign_in("u_a")
    assert await inbox(env, h) == [] and await inbox(env, h, host="b.example.test") == []


async def test_a_dropped_event_leaves_its_dedupe_key_free(env: Env) -> None:
    await env.register(schedule())
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(notify_channels=[]), id="e1")
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(), id="e1")
    assert len(await inbox(env, env.rights.sign_in("u_a"))) == 1


async def test_personal_notifications_reach_only_their_user(env: Env) -> None:
    await env.register(play())
    data = {"user_ids": ["u_a"], "game": "Chess", "host": "Host", "at": "2026-11-20T18:00:00Z"}
    await env.emit("ev-a", "games.session.invited", data)
    [mine] = await inbox(env, env.rights.sign_in("u_a"))
    assert mine["audience"] == "personal" and mine["title"] == "Chess with Host"
    assert await inbox(env, env.rights.sign_in("u_b")) == []
    async with env.client() as c:
        url = f"/api/notify/notifications/{mine['id']}"
        assert (await c.get(url, headers=env.rights.sign_in("u_a"))).status_code == 200
        assert (await c.get(url, headers=env.rights.sign_in("u_b"))).status_code == 404
        assert (await c.get(url)).status_code == 404


async def test_public_notifications_by_id_follow_the_info_page_mode(env: Env) -> None:
    await env.register(schedule())
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    await env.emit("ev-a", "agenda.reminder.triggered", reminder("attendees"), id="e2")
    notes = {n["audience"]: n for n in await inbox(env, env.rights.sign_in("u_a"))}
    async with env.client() as c:
        public = f"/api/notify/notifications/{notes['public']['id']}"
        attendees = f"/api/notify/notifications/{notes['attendees']['id']}"
        assert (await c.get(public)).json()["title"] == "Dinner at 18:00"
        assert (await c.get(attendees)).status_code == 404
        assert (await c.get(attendees, headers=env.rights.sign_in("u_b"))).status_code == 200
        env.contexts["ev-a"]["info_page_mode"] = "sign_in"
        assert (await c.get(public)).status_code == 404
    async with env.client("b.example.test") as b:
        assert (await b.get(public)).status_code == 404


async def test_the_inbox_needs_a_caller_drops_expired_and_takes_since(env: Env) -> None:
    await env.register(schedule())
    async with env.client() as c:
        assert (await c.get("/api/notify/inbox")).status_code == 401
        bad = await c.get("/api/notify/inbox?since=yesterday", headers=env.admin())
        assert bad.status_code == 400
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    h = env.rights.sign_in("u_a")
    async with env.client() as c:
        later = await c.get(
            "/api/notify/inbox", params={"since": "2026-11-20T17:00:00Z"}, headers=h
        )
        assert later.json()["notifications"] == []
    env.clock[0] = env.clock[0].replace(hour=18)
    assert await inbox(env, h) == []
