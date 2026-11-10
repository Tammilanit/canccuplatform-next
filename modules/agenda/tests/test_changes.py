"""The change log: who changed what, one row per revision of an item (plan issue-187 D13)."""

from __future__ import annotations

import json
from dataclasses import replace

from conftest import Env, at
from test_items import add
from test_mirror import feed, items


async def _log(env: Env, item_id: str) -> list[dict[str, object]]:
    async with env.db.tenant("ev-a") as conn:
        rows = await conn.fetch(
            "SELECT revision, action, actor_user_id, actor_name, fields, old, new"
            " FROM agenda_changes WHERE item_id = $1 ORDER BY revision, at",
            item_id,
        )
    return [{**dict(r), "old": json.loads(r["old"]), "new": json.loads(r["new"])} for r in rows]


async def test_every_write_records_who_changed_which_fields(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, starts_at=at(60), ends_at=at(120))
        await c.patch(
            f"/api/agenda/items/{item['id']}",
            json={"revision": 1, "title": "Supper", "location": "Café"},
            headers=h,
        )
        await c.post(
            f"/api/agenda/items/{item['id']}/delay", json={"revision": 2, "minutes": 15}, headers=h
        )
        await c.post(f"/api/agenda/items/{item['id']}/cancel", json={"revision": 3}, headers=h)
        log = await _log(env, item["id"])
        await c.delete(f"/api/agenda/items/{item['id']}?revision=4", headers=h)
        removed = await _log(env, item["id"])
    assert [(e["revision"], e["action"]) for e in log] == [
        (1, "added"),
        (2, "changed"),
        (3, "changed"),
        (4, "changed"),
    ]
    assert {e["actor_user_id"] for e in log} == {"u_org"}
    assert log[1]["fields"] == ["title", "location"]
    assert log[1]["old"] == {"title": "Dinner", "location": None}
    assert log[1]["new"] == {"title": "Supper", "location": "Café"}
    assert log[2]["fields"] == ["starts_at", "ends_at"]
    assert log[2]["old"] == {"starts_at": at(60), "ends_at": at(120)}
    assert log[3]["fields"] == ["status"] and log[3]["new"] == {"status": "cancelled"}
    assert removed[-1]["action"] == "removed" and removed[-1]["revision"] == 4


async def test_the_item_page_shows_who_changed_what(env: Env) -> None:
    h = env.writer()
    signed_in = env.rights.sessions["u_org"]
    env.rights.sessions["u_org"] = replace(signed_in, user_name="Riley")
    async with env.client() as c:
        item = await add(c, h, starts_at=at(60))
        await c.patch(
            f"/api/agenda/items/{item['id']}", json={"revision": 1, "title": "Supper"}, headers=h
        )
        page = await c.get(f"/items/{item['id']}", headers=h)
    text = page.text.split("Changes")[1]
    assert "Riley added it" in text
    assert "Riley changed title: Dinner → Supper" in text


async def test_the_tournament_mirror_is_logged_as_the_tournament_module(env: Env) -> None:
    await feed(env, "added")
    (item,) = await items(env)
    (entry,) = await _log(env, item["id"])
    assert (entry["action"], entry["actor_user_id"]) == ("added", None)
    assert entry["actor_name"] == "Tournament module"
