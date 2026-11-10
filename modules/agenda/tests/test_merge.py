"""A stale edit from the pages (plan issue-187 D13): re-applied on the current revision when its
fields do not overlap the fields changed since; otherwise the page shows who changed what."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import httpx
from conftest import Env, at
from test_items import add


def form_of(**changes: str) -> dict[str, str]:
    """The edit form as the organiser saw it at revision 1 of Dinner (18:00 to 19:00, UTC)."""
    return {
        "revision": "1",
        "title": "Dinner",
        "kind": "meal",
        "starts": "2026-11-20T18:00",
        "ends": "2026-11-20T19:00",
        "visibility": "public",
        "location": "",
        "zone": "",
        "reminders": "",
        "description": "",
        **changes,
    }


async def setup(env: Env, c: httpx.AsyncClient) -> tuple[dict[str, str], dict[str, str], str]:
    h = env.writer()
    sam = env.rights.sign_in("u_sam", "agenda.items.write")
    env.rights.sessions["u_sam"] = replace(env.rights.sessions["u_sam"], user_name="Sam")
    item = await add(c, h, starts_at=at(60), ends_at=at(120))
    return h, sam, item["id"]


async def current(c: httpx.AsyncClient, h: dict[str, str], item_id: str) -> dict[str, Any]:
    item: dict[str, Any] = (await c.get(f"/api/agenda/items/{item_id}", headers=h)).json()
    return item


async def test_a_stale_edit_of_other_fields_is_applied_on_top(env: Env) -> None:
    async with env.client() as c:
        h, sam, item_id = await setup(env, c)
        await c.patch(
            f"/api/agenda/items/{item_id}", json={"revision": 1, "location": "Hall"}, headers=sam
        )
        saved = await c.post(f"/items/{item_id}/edit", data=form_of(title="Supper"), headers=h)
        after = await current(c, h, item_id)
    assert saved.status_code == 303 and "done=saved" in saved.headers["location"]
    assert (after["title"], after["location"], after["revision"]) == ("Supper", "Hall", 3)


async def test_a_stale_edit_keeps_a_delay_made_meanwhile(env: Env) -> None:
    async with env.client() as c:
        h, sam, item_id = await setup(env, c)
        await c.post(
            f"/api/agenda/items/{item_id}/delay", json={"revision": 1, "minutes": 15}, headers=sam
        )
        saved = await c.post(f"/items/{item_id}/edit", data=form_of(location="Café"), headers=h)
        after = await current(c, h, item_id)
    assert saved.status_code == 303
    assert after["location"] == "Café"
    assert (after["starts_at"], after["delay_minutes"]) == (at(75), 15)


async def test_an_overlapping_stale_edit_shows_who_changed_what_and_saves_nothing(
    env: Env,
) -> None:
    async with env.client() as c:
        h, sam, item_id = await setup(env, c)
        await c.patch(
            f"/api/agenda/items/{item_id}", json={"revision": 1, "title": "Supper"}, headers=sam
        )
        env.store.calls.clear()
        clash = await c.post(
            f"/items/{item_id}/edit", data=form_of(title="Brunch", location="Café"), headers=h
        )
        after = await current(c, h, item_id)
    assert clash.status_code == 409
    assert "Sam changed title: Dinner → Supper" in clash.text
    assert "Your change to title was not saved" in clash.text
    assert 'name=title value="Supper"' in clash.text and 'name="revision" value="2"' in clash.text
    assert (after["title"], after.get("location")) == ("Supper", None)
    assert env.store.calls == []


async def test_without_the_full_log_a_stale_edit_is_not_merged(env: Env) -> None:
    async with env.client() as c:
        h, sam, item_id = await setup(env, c)
        await c.patch(
            f"/api/agenda/items/{item_id}", json={"revision": 1, "location": "Hall"}, headers=sam
        )
        # As for an item older than the log; the app's role may not delete log rows.
        async with env.db.pool.acquire() as conn:
            await conn.execute("DELETE FROM agenda_changes WHERE revision = 2")
        clash = await c.post(f"/items/{item_id}/edit", data=form_of(title="Supper"), headers=h)
        after = await current(c, h, item_id)
    assert clash.status_code == 409 and "Someone changed this item meanwhile" in clash.text
    assert after["title"] == "Dinner"
