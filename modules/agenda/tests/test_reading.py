"""Reading: lists, now and next, and who sees what (contracts/agenda.md, Reading)."""

from __future__ import annotations

from typing import Any

from conftest import Env, at
from test_items import add


async def test_list_filters_by_window_and_cancelled(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        early = await add(c, h, title="Doors", kind="doors", starts_at=at(-120))  # a moment
        late = await add(c, h, title="Show", starts_at=at(60), ends_at=at(90))
        gone = await add(c, h, title="Gone", starts_at=at(70))
        async with env.db.tenant("ev-a") as conn:
            await conn.execute(
                "UPDATE agenda_items SET status = 'cancelled' WHERE id = $1", gone["id"]
            )

        async def ids(query: str) -> list[str]:
            body = (await c.get(f"/api/agenda/items{query}")).json()
            assert body["agenda_version"] == 3
            return [i["id"] for i in body["items"]]

        assert await ids("") == [early["id"], late["id"], gone["id"]]
        assert await ids(f"?from={at(0)}") == [late["id"], gone["id"]]
        assert await ids(f"?to={at(60)}") == [early["id"]]
        assert await ids("?include_cancelled=false") == [early["id"], late["id"]]


async def test_now_and_next(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        running = await add(c, h, title="Lunch", starts_at=at(-30), ends_at=at(30))
        await add(c, h, title="Moment", kind="doors", starts_at=at(-10))  # no end: never "now"
        first = await add(c, h, title="A", starts_at=at(60), zone="main_hall")
        tie = await add(c, h, title="B", starts_at=at(60), zone="cafe")
        later_item = await add(c, h, title="Later", starts_at=at(90))
        body = (await c.get("/api/agenda/now")).json()
        assert body["time"] == at(0) and body["agenda_version"] == 5
        assert [i["id"] for i in body["current"]] == [running["id"]]
        assert {i["id"] for i in body["next"]} == {first["id"], tie["id"]}
        zoned = (await c.get("/api/agenda/now?zone=cafe")).json()
        assert [i["id"] for i in zoned["next"]] == [tie["id"]]
        env.clock[0] = env.clock[0].replace(hour=18)  # at(60): lunch ended, A and B (no end) began
        later = (await c.get("/api/agenda/now")).json()
        assert later["current"] == []
        assert [i["id"] for i in later["next"]] == [later_item["id"]]


async def test_who_sees_what(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        items: dict[str, Any] = {
            v: await add(c, h, title=v, visibility=v) for v in ("public", "attendees", "crew")
        }

        async def seen(headers: dict[str, str] | None = None) -> list[str]:
            body = (await c.get("/api/agenda/items", headers=headers or {})).json()
            return sorted(i["visibility"] for i in body["items"])  # equal starts: any order

        member = env.rights.sign_in("u_member")
        assert await seen() == ["public"]
        assert await seen(member) == ["attendees", "public"]
        assert await seen(h) == ["attendees", "crew", "public"]
        crew_url = f"/api/agenda/items/{items['crew']['id']}"
        hidden = await c.get(crew_url, headers=member)
        assert hidden.status_code == 404 and hidden.json()["error"]["code"] == "not_found"
        env.contexts["ev-a"]["info_page_mode"] = "sign_in"
        closed = await c.get("/api/agenda/now")
        assert closed.status_code == 403 and closed.json()["error"]["code"] == "info_pages_closed"
        assert (await c.get("/api/agenda/now", headers=member)).status_code == 200
