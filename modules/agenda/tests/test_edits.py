"""Delay with following, cancel and remove (contracts/agenda.md, Editing live)."""

from __future__ import annotations

from typing import Any

import httpx
from conftest import Env, at
from test_items import add


async def delay(
    c: httpx.AsyncClient, h: dict[str, str], item: dict[str, Any], **body: Any
) -> httpx.Response:
    return await c.post(
        f"/api/agenda/items/{item['id']}/delay",
        json={"revision": item["revision"], **body},
        headers=h,
    )


async def test_delay_shifts_current_times_and_keeps_the_plan(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        later = await add(c, h, title="Show", starts_at=at(180))
        response = await delay(c, h, item, minutes=15)
    assert response.status_code == 200, response.text
    body = response.json()
    (moved,) = body["items"]
    assert moved["starts_at"] == at(75) and moved["ends_at"] == at(135)
    assert moved["planned_starts_at"] == at(60) and moved["planned_ends_at"] == at(120)
    assert moved["delay_minutes"] == 15 and moved["revision"] == 2
    assert body["agenda_version"] == 3
    event = env.events()[-1]
    assert event["type"] == "agenda.item.delayed"
    assert event["data"] == {
        "item": moved,
        "minutes": 15,
        "announce": True,
        "agenda_version": 3,
        "actor_user_id": "u_org",
    }
    async with env.client() as c:
        untouched = (await c.get(f"/api/agenda/items/{later['id']}")).json()
    assert untouched["starts_at"] == at(180)


async def test_delay_with_following_moves_later_items_but_not_quiet_hours(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        earlier = await add(c, h, title="Doors", kind="doors", starts_at=at(30))
        dinner = await add(c, h, ends_at=at(120))
        quiet = await add(
            c, h, title="Quiet", kind="quiet_hours", starts_at=at(90), ends_at=at(600)
        )
        show = await add(c, h, title="Show", starts_at=at(150), ends_at=at(200))
        same = await add(c, h, title="Also", starts_at=at(60))
        gone = await add(c, h, title="Gone", starts_at=at(170))
        await c.post(f"/api/agenda/items/{gone['id']}/cancel", json={"revision": 1}, headers=h)
        env.store.calls.clear()
        response = await delay(c, h, dinner, minutes=20, following=True)
        assert response.status_code == 200, response.text
        listed = {i["id"]: i for i in (await c.get("/api/agenda/items")).json()["items"]}
    body = response.json()
    assert body["items"][0]["id"] == dinner["id"]  # this one first
    assert {i["id"] for i in body["items"]} == {dinner["id"], same["id"], show["id"]}
    assert listed[show["id"]]["starts_at"] == at(170) and listed[show["id"]]["delay_minutes"] == 20
    assert listed[same["id"]]["starts_at"] == at(80)
    for untouched, start in ((earlier, at(30)), (quiet, at(90)), (gone, at(170))):
        assert listed[untouched["id"]]["starts_at"] == start
    events = env.events()
    assert [e["type"] for e in events] == ["agenda.item.delayed"] * 3
    starts = [e["data"]["item"]["starts_at"] for e in events]
    assert starts == sorted(starts)  # in order of the new start
    assert len({e["correlation_id"] for e in events}) == 1 and events[0]["correlation_id"]
    versions = [e["data"]["agenda_version"] for e in events]
    assert versions == [8, 9, 10] and body["agenda_version"] == 10  # never skip or repeat


async def test_a_running_item_keeps_its_start_and_only_its_end_moves(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        running = await add(c, h, starts_at=at(-30), ends_at=at(30))
        moment = await add(c, h, title="Doors", kind="doors", starts_at=at(-10))
        response = await delay(c, h, running, minutes=15, following=True)
        assert response.status_code == 200, response.text
        (moved,) = response.json()["items"]  # a moment already past has nothing to move
        assert moved["starts_at"] == at(-30) and moved["delay_minutes"] == 0
        assert moved["ends_at"] == at(45) and moved["planned_ends_at"] == at(30)
        started = await delay(c, h, moment, minutes=5)
    assert (started.status_code, started.json()["error"]["code"]) == (409, "item_started")


async def test_a_shift_that_breaks_an_item_shifts_nothing(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        running = await add(c, h, starts_at=at(-30), ends_at=at(10))
        later = await add(c, h, title="Show", starts_at=at(60))
        response = await delay(c, h, running, minutes=-40, following=True)
        assert (response.status_code, response.json()["error"]["code"]) == (400, "invalid_request")
        listed = (await c.get("/api/agenda/items")).json()
    assert [i["revision"] for i in listed["items"]] == [1, 1]
    assert listed["agenda_version"] == 2 and later["starts_at"] == at(60)
    assert [e["type"] for e in env.events()] == ["agenda.item.added"] * 2


async def test_delay_refuses_bad_requests(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h)
        for body in (
            {"minutes": 0},
            {"minutes": 721},
            {"minutes": 1.5},
            {"minutes": 5, "following": "yes"},
        ):
            response = await delay(c, h, item, **body)
            assert (response.status_code, response.json()["error"]["code"]) == (
                400,
                "invalid_request",
            ), body
        stale = await c.post(
            f"/api/agenda/items/{item['id']}/delay", json={"revision": 9, "minutes": 5}, headers=h
        )
        assert stale.json()["error"]["code"] == "version_conflict"
        missing = await c.post(
            "/api/agenda/items/it_nope/delay", json={"revision": 1, "minutes": 5}, headers=h
        )
        assert missing.status_code == 404
        await c.post(f"/api/agenda/items/{item['id']}/cancel", json={"revision": 1}, headers=h)
        cancelled = await delay(c, h, {**item, "revision": 2}, minutes=5)
        assert cancelled.json()["error"]["code"] == "item_cancelled"
        reader = env.rights.sign_in("u_crew", "agenda.crew.read")
        denied = await delay(c, reader, item, minutes=5)
    assert denied.status_code == 403


async def test_a_session_item_is_delayed_like_any_other(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        async with env.db.tenant("ev-a") as conn:
            await conn.execute(
                "UPDATE agenda_items SET managed_by = 'tournament', tournament_session_id = 's1'"
            )
        response = await delay(c, h, item, minutes=-10)
    assert response.status_code == 200
    assert response.json()["items"][0]["starts_at"] == at(50)


async def test_cancel_is_final_and_keeps_the_item(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h)
        url = f"/api/agenda/items/{item['id']}/cancel"
        stale = await c.post(url, json={"revision": 3}, headers=h)
        assert stale.json()["error"]["code"] == "version_conflict"
        response = await c.post(url, json={"revision": 1}, headers=h)
        assert response.status_code == 200, response.text
        again = await c.post(url, json={"revision": 2}, headers=h)
        assert again.json()["error"]["code"] == "item_cancelled"
        listed = (await c.get("/api/agenda/items")).json()["items"]
        scheduled = (await c.get("/api/agenda/items?include_cancelled=false")).json()["items"]
    cancelled = response.json()
    assert cancelled["status"] == "cancelled" and cancelled["revision"] == 2
    assert listed == [cancelled] and scheduled == []
    event = env.events()[-1]
    assert event["type"] == "agenda.item.cancelled"
    assert event["data"] == {"item": cancelled, "agenda_version": 2, "actor_user_id": "u_org"}


async def test_remove_deletes_and_emits_only_the_id(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, visibility="crew")
        url = f"/api/agenda/items/{item['id']}"
        stale = await c.delete(f"{url}?revision=2", headers=h)
        assert stale.json()["error"]["code"] == "version_conflict"
        bad = await c.delete(f"{url}?revision=x", headers=h)
        assert bad.json()["error"]["code"] == "invalid_request"
        response = await c.delete(f"{url}?revision=1", headers=h)
        assert response.status_code == 204
        assert (await c.get(url, headers=h)).status_code == 404
        assert (await c.delete(f"{url}?revision=1", headers=h)).status_code == 404
    event = env.events()[-1]
    assert event["type"] == "agenda.item.removed"
    assert event["data"] == {
        "item_id": item["id"],
        "visibility": "crew",
        "agenda_version": 2,
        "actor_user_id": "u_org",
    }


async def test_a_session_item_cannot_be_cancelled_or_removed_here(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h)
        async with env.db.tenant("ev-a") as conn:
            await conn.execute(
                "UPDATE agenda_items SET managed_by = 'tournament', tournament_session_id = 's1'"
            )
        url = f"/api/agenda/items/{item['id']}"
        cancel = await c.post(f"{url}/cancel", json={"revision": 1}, headers=h)
        remove = await c.delete(f"{url}?revision=1", headers=h)
    assert cancel.json()["error"]["code"] == "item_managed"
    assert remove.json()["error"]["code"] == "item_managed"


async def test_writes_after_archiving_are_refused(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h)
        env.contexts["ev-a"]["status"] = "archived"
        url = f"/api/agenda/items/{item['id']}"
        responses = [
            await delay(c, h, item, minutes=5),
            await c.post(f"{url}/cancel", json={"revision": 1}, headers=h),
            await c.delete(f"{url}?revision=1", headers=h),
        ]
    assert [r.json()["error"]["code"] for r in responses] == ["event_archived"] * 3


async def test_events_follow_the_new_start_not_the_old_one(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        target = await add(c, h, title="Target", starts_at=at(-30), ends_at=at(60))
        await add(c, h, title="Running", starts_at=at(-10), ends_at=at(40))
        await add(c, h, title="Ahead", kind="doors", starts_at=at(5))
        env.store.calls.clear()
        response = await delay(c, h, target, minutes=-20, following=True)
    assert response.status_code == 200, response.text
    # Running items keep their starts, so "Ahead" (5 → -15) now comes before "Running" (-10).
    titles = [e["data"]["item"]["title"] for e in env.events()]
    assert titles == ["Target", "Ahead", "Running"]
    assert [e["data"]["agenda_version"] for e in env.events()] == [4, 5, 6]


async def test_following_leaves_items_that_have_ended(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        block = await add(c, h, title="Block", starts_at=at(-60), ends_at=at(120))
        await add(c, h, title="Done", starts_at=at(-45), ends_at=at(-30))
        response = await delay(c, h, block, minutes=60, following=True)
        assert response.status_code == 200, response.text
        listed = {i["title"]: i for i in (await c.get("/api/agenda/items")).json()["items"]}
    assert [i["title"] for i in response.json()["items"]] == ["Block"]
    assert listed["Done"]["ends_at"] == at(-30) and listed["Done"]["revision"] == 1
