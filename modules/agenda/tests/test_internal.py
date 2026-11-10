"""The module read of all items (contracts/agenda.md, Reading: for modules)."""

from __future__ import annotations

from canccu_kit import ServiceIdentity
from conftest import KEY, Env, at
from test_items import add

URL = "/internal/agenda/items"
SCREEN = ServiceIdentity("screen", KEY)


async def test_a_module_reads_every_item_of_the_event(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        crew = await add(c, h, title="Crew brief", visibility="crew", starts_at=at(30))
        public = await add(c, h, title="Doors", kind="doors", starts_at=at(-60))
        members = await add(c, h, title="Meetup", visibility="attendees", starts_at=at(90))
        gone = await add(c, h, title="Gone", starts_at=at(120))
        cancelled = await c.post(
            f"/api/agenda/items/{gone['id']}/cancel", json={"revision": 1}, headers=h
        )
        assert cancelled.status_code == 200, cancelled.text
        as_crew = (await c.get(f"/api/agenda/items/{crew['id']}", headers=h)).json()
    async with env.client("b.example.test") as c:
        await add(c, env.writer(), title="Other event", starts_at=at(10))
    async with env.internal() as c:
        r = await c.get(URL, params={"tenant_id": "ev-a"}, headers=SCREEN.headers("agenda"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["agenda_version"] == 5
    ids = [i["id"] for i in body["items"]]
    assert ids == [public["id"], crew["id"], members["id"], gone["id"]]
    assert body["items"][1] == as_crew
    assert body["items"][3]["status"] == "cancelled"


async def test_only_modules_of_the_stack_and_known_events(env: Env) -> None:
    async with env.internal() as c:
        ev_a = {"tenant_id": "ev-a"}
        assert (await c.get(URL, params=ev_a)).status_code == 401
        other_key = ServiceIdentity("screen", b"x" * 32).headers("agenda")
        assert (await c.get(URL, params=ev_a, headers=other_key)).status_code == 401
        for tenant in ("ev-gone", "Not An Id", ""):
            r = await c.get(URL, params={"tenant_id": tenant}, headers=SCREEN.headers("agenda"))
            assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
