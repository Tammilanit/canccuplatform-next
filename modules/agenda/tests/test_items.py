"""Adding, editing and moving items, and their events (contracts/agenda.md, Editing live)."""

from __future__ import annotations

from typing import Any

import httpx
from conftest import Env, at


async def add(c: httpx.AsyncClient, h: dict[str, str], **fields: Any) -> dict[str, Any]:
    body = {"title": "Dinner", "kind": "meal", "starts_at": at(60), "visibility": "public"}
    response = await c.post("/api/agenda/items", json={**body, **fields}, headers=h)
    assert response.status_code == 201, response.text
    item: dict[str, Any] = response.json()
    return item


async def test_add_sets_planned_times_and_emits_added(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120), location="Main stage", zone="main_hall")
    assert item["planned_starts_at"] == item["starts_at"] == at(60)
    assert item["planned_ends_at"] == item["ends_at"] == at(120)
    assert item["delay_minutes"] == 0 and item["status"] == "scheduled"
    assert item["revision"] == 1 and item["links"] == {}
    assert item["notify_channels"] == ["screen", "discord_channel", "push"]
    (event,) = env.events()
    assert event["type"] == "agenda.item.added" and event["tenant"] == "ev-a"
    assert event["data"] == {"item": item, "agenda_version": 1, "actor_user_id": "u_org"}


async def test_add_refuses_bad_items(env: Env) -> None:
    h = env.writer()
    base = {"title": "Quiet", "kind": "quiet_hours", "starts_at": at(0), "visibility": "public"}
    cases = [
        (base, "invalid_request"),  # quiet hours need an end
        ({**base, "kind": "meal", "ends_at": at(0)}, "invalid_request"),  # end not after start
        ({**base, "kind": "nope"}, "unknown_kind"),
        ({**base, "kind": "meal", "links": {"tournament_session_id": "s"}}, "invalid_request"),
        ({**base, "kind": "meal", "visibility": "everyone"}, "invalid_request"),
    ]
    async with env.client() as c:
        for body, code in cases:
            response = await c.post("/api/agenda/items", json=body, headers=h)
            assert (response.status_code, response.json()["error"]["code"]) == (400, code)
    assert env.events() == []


async def test_a_move_is_a_new_plan_and_resets_the_delay(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        async with env.db.tenant("ev-a") as conn:  # a delay of 15 minutes (#210 builds the path)
            await conn.execute(
                "UPDATE agenda_items SET starts_at = starts_at + interval '15 min',"
                " ends_at = ends_at + interval '15 min', revision = 2 WHERE id = $1",
                item["id"],
            )
        delayed = (await c.get(f"/api/agenda/items/{item['id']}")).json()
        assert delayed["delay_minutes"] == 15
        moved = await c.patch(
            f"/api/agenda/items/{item['id']}",
            json={"revision": 2, "starts_at": at(120), "ends_at": at(180), "location": None},
            headers=h,
        )
    body = moved.json()
    assert body["starts_at"] == body["planned_starts_at"] == at(120)
    assert body["ends_at"] == body["planned_ends_at"] == at(180)
    assert body["delay_minutes"] == 0 and body["revision"] == 3
    changed = env.events()[-1]
    assert changed["type"] == "agenda.item.changed"
    assert changed["data"]["changed"] == ["starts_at", "ends_at"]  # location was already unset
    assert changed["data"]["agenda_version"] == 2


async def test_edit_checks_revision_cancelled_and_managed(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h)
        url = f"/api/agenda/items/{item['id']}"
        stale = await c.patch(url, json={"revision": 5, "title": "X"}, headers=h)
        assert stale.json()["error"]["code"] == "version_conflict"
        async with env.db.tenant("ev-a") as conn:
            await conn.execute(
                "UPDATE agenda_items SET managed_by = 'tournament',"
                " tournament_session_id = 's1' WHERE id = $1",
                item["id"],
            )
        managed = await c.patch(url, json={"revision": 1, "title": "Final"}, headers=h)
        assert managed.json()["error"]["code"] == "item_managed"
        kept = await c.patch(url, json={"revision": 1, "description": "Bring snacks"}, headers=h)
        assert kept.status_code == 200 and kept.json()["description"] == "Bring snacks"
        assert kept.json()["links"] == {"tournament_session_id": "s1"}
        async with env.db.tenant("ev-a") as conn:
            await conn.execute("UPDATE agenda_items SET status = 'cancelled'")
        cancelled = await c.patch(url, json={"revision": 2, "title": "Y"}, headers=h)
        assert cancelled.json()["error"]["code"] == "item_cancelled"


async def test_an_edit_that_changes_nothing_emits_nothing(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h)
        same = await c.patch(
            f"/api/agenda/items/{item['id']}", json={"revision": 1, "title": "Dinner"}, headers=h
        )
    assert same.json()["revision"] == 1
    assert [e["type"] for e in env.events()] == ["agenda.item.added"]


async def test_channels_in_effect_follow_item_kind_and_event(env: Env) -> None:
    h = env.writer()
    env.settings.values["ev-a"] = {"notify_channels": ["push"]}
    async with env.client() as c:
        plain = await add(c, h)
        silent = await add(c, h, notify=[])
        await c.put(
            "/api/agenda/kinds/doors",
            json={"name": "Doors", "revision": 1, "notify": ["screen"]},
            headers=h,
        )
        doors = await add(c, h, kind="doors")
    assert plain["notify_channels"] == ["push"]
    assert silent["notify_channels"] == [] and silent["notify"] == []
    assert doors["notify_channels"] == ["screen"] and doors["notify"] is None


async def test_writes_on_an_archived_event_are_refused(env: Env) -> None:
    env.contexts["ev-a"]["status"] = "archived"
    async with env.client() as c:
        response = await c.post(
            "/api/agenda/items",
            json={"title": "X", "kind": "meal", "starts_at": at(0), "visibility": "public"},
            headers=env.writer(),
        )
        assert response.json()["error"]["code"] == "event_archived"
        assert (await c.get("/api/agenda/items")).status_code == 200
