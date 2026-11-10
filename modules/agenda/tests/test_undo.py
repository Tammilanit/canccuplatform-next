"""The 2-minute undo of a page action (plan issue-187 D12): it runs through the normal writes, so
people who were told are told again, and it never overwrites a change made since."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
from conftest import Env, at
from test_items import add


def undo_id(response: httpx.Response) -> str:
    assert response.status_code == 303, response.text
    (value,) = parse_qs(urlsplit(response.headers["location"]).query)["undo"]
    return value


async def items(c: httpx.AsyncClient, h: dict[str, str]) -> list[dict[str, Any]]:
    listed: list[dict[str, Any]] = (await c.get("/api/agenda/items", headers=h)).json()["items"]
    return listed


async def test_the_notice_after_a_change_offers_undo_and_says_people_are_told_again(
    env: Env,
) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        done = await c.post(f"/items/{item['id']}/cancel", data={"revision": "1"}, headers=h)
        landed = await c.get(done.headers["location"].removeprefix("/agenda"), headers=h)
        other = env.rights.sign_in("u_sam", "agenda.items.write")
        theirs = await c.get(done.headers["location"].removeprefix("/agenda"), headers=other)
    token = undo_id(done)
    assert f'action="/agenda/undo/{token}"' in landed.text
    assert "People who were told are told again." in landed.text
    assert token not in theirs.text  # an undo is its author's


async def test_undo_a_delay_with_following_puts_every_item_back(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        dinner = await add(c, h, ends_at=at(120))
        await add(c, h, title="Show", starts_at=at(180), ends_at=at(240))
        form = {"revision": "1", "minutes": "15", "following": "1", "agenda_version": "2"}
        token = undo_id(await c.post(f"/items/{dinner['id']}/delay", data=form, headers=h))
        env.store.calls.clear()
        undone = await c.post(f"/undo/{token}", headers=h)
        after = await items(c, h)
        again = await c.post(f"/undo/{token}", headers=h)
        landed = await c.get(undone.headers["location"].removeprefix("/agenda"), headers=h)
    assert [(i["starts_at"], i["ends_at"], i["delay_minutes"]) for i in after] == [
        (at(60), at(120), 0),
        (at(180), at(240), 0),
    ]
    events = env.events()
    assert [e["type"] for e in events] == ["agenda.item.delayed"] * 2
    assert {e["data"]["minutes"] for e in events} == {-15}
    assert len({e["correlation_id"] for e in events}) == 1
    assert "Undone. People who were told are told again." in landed.text
    assert again.status_code == 404  # used once


async def test_undo_an_add_removes_it(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        added = await c.post(
            "/add", data={"title": "Pizza", "what": "kind:meal", "when": "now"}, headers=h
        )
        await c.post(f"/undo/{undo_id(added)}", headers=h)
        after = await items(c, h)
    assert after == []
    assert env.events()[-1]["type"] == "agenda.item.removed"


async def test_undo_an_edit_restores_the_old_values_and_keeps_an_earlier_delay(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, starts_at=at(60), ends_at=at(120))
        await c.post(
            f"/api/agenda/items/{item['id']}/delay", json={"revision": 1, "minutes": 10}, headers=h
        )
        form = {
            "revision": "2",
            "title": "Supper",
            "kind": "meal",
            "starts": "2026-11-20T19:00",
            "ends": "2026-11-20T20:00",
            "visibility": "public",
            "confirm": "1",
        }
        saved = await c.post(f"/items/{item['id']}/edit", data=form, headers=h)
        moved = (await items(c, h))[0]
        await c.post(f"/undo/{undo_id(saved)}", headers=h)
        (after,) = await items(c, h)
    assert moved["title"] == "Supper" and moved["delay_minutes"] == 0
    assert after["title"] == "Dinner" and after["starts_at"] == at(70)
    assert after["delay_minutes"] == 10 and after["planned_starts_at"] == at(60)
    changed = env.events()[-1]
    assert changed["type"] == "agenda.item.changed"
    assert set(changed["data"]["changed"]) == {"title", "starts_at", "ends_at"}


async def test_undo_a_cancel_adds_the_item_again(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, title="Raffle", starts_at=at(30), zone="main_hall")
        done = await c.post(f"/items/{item['id']}/cancel", data={"revision": "1"}, headers=h)
        env.store.calls.clear()
        await c.post(f"/undo/{undo_id(done)}", headers=h)
        (after,) = await items(c, h)
    assert after["id"] != item["id"] and after["status"] == "scheduled"
    assert (after["title"], after["starts_at"], after["zone"]) == ("Raffle", at(30), "main_hall")
    assert [e["type"] for e in env.events()] == ["agenda.item.added", "agenda.item.removed"]


async def test_undo_show_now_puts_the_item_back_at_its_time(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        quiz = await add(c, h, title="Quiz", starts_at=at(45), ends_at=at(105))
        done = await c.post(f"/items/{quiz['id']}/show-now", data={"revision": "1"}, headers=h)
        await c.post(f"/undo/{undo_id(done)}", headers=h)
        (after,) = await items(c, h)
    assert (after["starts_at"], after["ends_at"], after["delay_minutes"]) == (at(45), at(105), 0)


async def test_undo_refuses_when_an_item_changed_since_and_names_who(env: Env) -> None:
    h = env.writer()
    sam = env.rights.sign_in("u_sam", "agenda.items.write")
    env.rights.sessions["u_sam"] = replace(env.rights.sessions["u_sam"], user_name="Sam")
    async with env.client() as c:
        dinner = await add(c, h, ends_at=at(120))
        show = await add(c, h, title="Show", starts_at=at(180))
        form = {"revision": "1", "minutes": "15", "following": "1", "agenda_version": "2"}
        token = undo_id(await c.post(f"/items/{dinner['id']}/delay", data=form, headers=h))
        await c.patch(
            f"/api/agenda/items/{show['id']}", json={"revision": 2, "location": "Hall"}, headers=sam
        )
        env.store.calls.clear()
        refused = await c.post(f"/undo/{token}", headers=h)
        after = await items(c, h)
    assert refused.status_code == 409
    assert "Sam changed Show since (place): nothing was undone." in refused.text
    assert [i["delay_minutes"] for i in after] == [15, 15]
    assert env.store.calls == []


async def test_undo_is_its_authors_and_lasts_two_minutes(env: Env) -> None:
    h = env.writer()
    sam = env.rights.sign_in("u_sam", "agenda.items.write")
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        form = {"revision": "1", "minutes": "15", "following": "", "agenda_version": "1"}
        token = undo_id(await c.post(f"/items/{item['id']}/delay", data=form, headers=h))
        theirs = await c.post(f"/undo/{token}", headers=sam)
        env.clock[0] += timedelta(seconds=121)
        late = await c.post(f"/undo/{token}", headers=h)
        (after,) = await items(c, h)
    assert theirs.status_code == 404
    assert late.status_code == 409 and "more than 2 minutes" in late.text
    assert after["delay_minutes"] == 15


async def test_undo_a_cancel_refuses_when_its_kind_is_gone(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, title="Raffle", kind="activity", starts_at=at(30))
        done = await c.post(f"/items/{item['id']}/cancel", data={"revision": "1"}, headers=h)
        # The kind API refuses while the cancelled item uses it; this stands for any other way.
        async with env.db.pool.acquire() as conn:
            await conn.execute("DELETE FROM agenda_kinds WHERE key = 'activity'")
        env.store.calls.clear()
        refused = await c.post(f"/undo/{undo_id(done)}", headers=h)
        (after,) = await items(c, h)
    assert refused.status_code == 409 and "kind" in refused.text
    assert after["status"] == "cancelled" and env.store.calls == []
