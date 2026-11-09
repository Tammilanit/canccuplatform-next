"""The tenants contract's admin-access rule, and reads that survive admin being down."""

from __future__ import annotations

import pytest
from conftest import Env, at
from test_items import add

OUTSIDE = "198.51.100.7"  # the test client's address (conftest)


def restrict(env: Env, venue: list[str]) -> None:
    ctx = env.contexts["ev-a"]
    ctx["admin_access"] = "restricted"
    ctx["venue"] = {"id": "v", "name": "Venue", "addresses": venue}


@pytest.fixture(autouse=True)
def no_tailscale(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CANCCU_TAILSCALE_CIDRS", "100.64.0.0/10")


async def test_writes_from_outside_a_restricted_event_are_refused(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h)
        restrict(env, ["192.0.2.0/24"])
        new = {"title": "X", "kind": "meal", "starts_at": at(0), "visibility": "public"}
        calls = [
            c.post("/api/agenda/items", json=new, headers=h),
            c.patch(
                f"/api/agenda/items/{item['id']}", json={"revision": 1, "title": "Y"}, headers=h
            ),
            c.put("/api/agenda/kinds/cosplay", json={"name": "Cosplay"}, headers=h),
            c.delete("/api/agenda/kinds/doors?revision=1", headers=h),
        ]
        for call in calls:
            response = await call
            assert response.status_code == 403
            assert response.json()["error"]["code"] == "admin_access_restricted"
    assert [e["type"] for e in env.events()] == ["agenda.item.added"]


async def test_writes_from_the_venue_pass_on_a_restricted_event(env: Env) -> None:
    restrict(env, [f"{OUTSIDE}/32"])
    async with env.client() as c:
        item = await add(c, env.writer())
        patch = await c.patch(
            f"/api/agenda/items/{item['id']}",
            json={"revision": 1, "title": "Y"},
            headers=env.writer(),
        )
        assert patch.status_code == 200
        kind = await c.put(
            "/api/agenda/kinds/cosplay", json={"name": "Cosplay"}, headers=env.writer()
        )
        assert kind.status_code == 201


async def test_crew_items_follow_the_admin_access_rule(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        for v in ("public", "attendees", "crew"):
            await add(c, h, title=v, visibility=v)
        restrict(env, ["192.0.2.0/24"])
        body = (await c.get("/api/agenda/items", headers=h)).json()
        assert sorted(i["visibility"] for i in body["items"]) == ["attendees", "public"]
        restrict(env, [f"{OUTSIDE}/32"])
        body = (await c.get("/api/agenda/items", headers=h)).json()
        assert sorted(i["visibility"] for i in body["items"]) == ["attendees", "crew", "public"]


async def test_reads_keep_working_while_admin_is_down_but_writes_stop(env: Env) -> None:
    h = env.writer()
    env.settings.values["ev-a"] = {"notify_channels": ["push"]}
    async with env.client() as c:
        await add(c, h, starts_at=at(30))
        env.settings.down = True
        now = await c.get("/api/agenda/now")
        assert now.status_code == 200
        assert now.json()["next"][0]["notify_channels"] == ["screen", "discord_channel", "push"]
        new = {"title": "X", "kind": "meal", "starts_at": at(0), "visibility": "public"}
        write = await c.post("/api/agenda/items", json=new, headers=h)
        assert write.status_code == 503
        assert write.json()["error"]["code"] == "admin_unavailable"


async def test_an_item_that_ended_at_from_is_not_in_the_window(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        await add(c, h, starts_at=at(-60), ends_at=at(0))
        running = await add(c, h, starts_at=at(-10), ends_at=at(10))
        body = (await c.get(f"/api/agenda/items?from={at(0)}")).json()
    assert [i["id"] for i in body["items"]] == [running["id"]]
