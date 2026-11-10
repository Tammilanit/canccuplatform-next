"""Announce (contracts/agenda.md, Editing live): tells people now and changes nothing."""

from __future__ import annotations

from collections.abc import Awaitable

import httpx
from conftest import Env, at
from test_items import add


async def test_announce_emits_the_item_with_the_message_and_changes_nothing(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, starts_at=at(30))
        env.store.calls.clear()
        r = await c.post(
            f"/api/agenda/items/{item['id']}/announce", json={"message": "Café, now"}, headers=h
        )
        again = await c.post(f"/api/agenda/items/{item['id']}/announce", json={}, headers=h)
        after = (await c.get(f"/api/agenda/items/{item['id']}", headers=h)).json()
        listed = (await c.get("/api/agenda/items", headers=h)).json()
    assert r.status_code == 204 and again.status_code == 204
    first, second = env.events()
    assert first["type"] == "agenda.item.announced"
    assert first["data"]["item"] == item and first["data"]["message"] == "Café, now"
    assert first["data"]["agenda_version"] == listed["agenda_version"] == 1
    assert first["data"]["actor_user_id"] == "u_org"
    assert second["data"]["message"] is None
    assert after["revision"] == item["revision"]


async def test_announce_refuses_quiet_hours_cancelled_long_messages_and_readers(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        quiet = await add(c, h, kind="quiet_hours", starts_at=at(60), ends_at=at(600))
        gone = await add(c, h, title="Gone")
        await c.post(f"/api/agenda/items/{gone['id']}/cancel", json={"revision": 1}, headers=h)
        item = await add(c, h, title="Raffle")
        env.store.calls.clear()

        def post(
            item_id: str, data: object, headers: dict[str, str] = h
        ) -> Awaitable[httpx.Response]:
            return c.post(f"/api/agenda/items/{item_id}/announce", json=data, headers=headers)

        quiet_r = await post(quiet["id"], {})
        gone_r = await post(gone["id"], {})
        long_r = await post(item["id"], {"message": "x" * 141})
        missing = await post("it_nope", {})
        reader = await post(item["id"], {}, env.rights.sign_in("u_crew", "agenda.crew.read"))
    assert quiet_r.status_code == 400 and quiet_r.json()["error"]["code"] == "invalid_request"
    assert gone_r.status_code == 409 and gone_r.json()["error"]["code"] == "item_cancelled"
    assert long_r.status_code == 400
    assert missing.status_code == 404
    assert reader.status_code == 403
    assert env.store.calls == []
