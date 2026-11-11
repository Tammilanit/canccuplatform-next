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


NOW_URL = "/internal/agenda/now"


async def test_screens_read_public_now_and_next_in_every_mode(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        running = await add(c, h, title="Lunch", starts_at=at(-30), ends_at=at(30))
        await add(c, h, title="Crew", visibility="crew", starts_at=at(-30), ends_at=at(30))
        await add(c, h, title="Meetup", visibility="attendees", starts_at=at(40))
        await add(c, h, title="Brief", visibility="crew", starts_at=at(40))
        hall = await add(c, h, title="Show", starts_at=at(60), zone="main_hall")
        await add(c, h, title="Cafe", starts_at=at(60), zone="cafe")
        guest = (await c.get("/api/agenda/now?zone=main_hall")).json()
    assert [i["id"] for i in guest["current"]] == [running["id"]]
    assert [i["id"] for i in guest["next"]] == [hall["id"]]
    params = {"tenant_id": "ev-a", "zone": "main_hall"}
    for mode in ("public", "venue_only", "sign_in"):
        env.contexts["ev-a"]["info_page_mode"] = mode
        async with env.internal() as c:
            r = await c.get(NOW_URL, params=params, headers=SCREEN.headers("agenda"))
        assert r.status_code == 200, (mode, r.text)
        assert r.json() == guest, mode
    async with env.client() as c:
        refused = await c.get("/api/agenda/now")
    assert refused.json()["error"]["code"] == "info_pages_closed"  # the guest gate still holds


async def test_screens_read_now_without_a_zone_and_in_every_status(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        cafe = await add(c, h, title="Cafe", starts_at=at(60), zone="cafe")
    for status in ("draft", "live", "archived"):
        env.contexts["ev-a"]["status"] = status
        async with env.internal() as c:
            r = await c.get(NOW_URL, params={"tenant_id": "ev-a"}, headers=SCREEN.headers("agenda"))
        assert r.status_code == 200, (status, r.text)
        assert [i["id"] for i in r.json()["next"]] == [cafe["id"]]


async def test_now_is_for_the_screen_module_only(env: Env) -> None:
    ev_a = {"tenant_id": "ev-a"}
    async with env.internal() as c:
        assert (await c.get(NOW_URL, params=ev_a)).status_code == 401
        notify = ServiceIdentity("notify", KEY).headers("agenda")
        r = await c.get(NOW_URL, params=ev_a, headers=notify)
        assert r.status_code == 403 and r.json()["error"]["code"] == "service_forbidden"
        for tenant in ("ev-gone", "Not An Id", ""):
            r = await c.get(NOW_URL, params={"tenant_id": tenant}, headers=SCREEN.headers("agenda"))
            assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
        bad_zone = await c.get(
            NOW_URL,
            params={"tenant_id": "ev-a", "zone": "Not A Zone"},
            headers=SCREEN.headers("agenda"),
        )
        assert bad_zone.status_code == 400 and bad_zone.json()["error"]["code"] == "invalid_request"
