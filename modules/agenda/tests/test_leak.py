"""Cross-tenant leak tests: one event never reads or writes another's agenda."""

from __future__ import annotations

from canccu_kit.testing import assert_tenant_isolation
from conftest import Env, at
from test_items import add


async def test_another_events_items_do_not_exist_there(env: Env) -> None:
    h = env.writer()
    async with env.client("a.example.test") as a, env.client("b.example.test") as b:
        item = await add(a, h)
        assert (await b.get("/api/agenda/items", headers=h)).json()["items"] == []
        assert (await b.get(f"/api/agenda/items/{item['id']}", headers=h)).status_code == 404
        patch = await b.patch(
            f"/api/agenda/items/{item['id']}", json={"revision": 1, "title": "X"}, headers=h
        )
        assert patch.status_code == 404
        assert (await b.get("/api/agenda/now", headers=h)).json()["next"] == []
        assert (await b.get("/api/agenda/kinds")).json()["kinds_version"] == 0
        assert item["id"] not in (await b.get("/", headers=h)).text
        for path in ("", "/edit", "/delay", "/cancel", "/show-now"):
            assert (await b.get(f"/items/{item['id']}{path}", headers=h)).status_code == 404


async def test_another_events_templates_do_not_exist_there(env: Env) -> None:
    h = env.writer()
    async with env.client("a.example.test") as a, env.client("b.example.test") as b:
        await a.post(
            "/templates/new",
            data={"name": "Raffle", "kind": "other", "visibility": "public"},
            headers=h,
        )
        mine = (await a.get("/templates", headers=h)).text
        tid = mine.split('href="/agenda/templates/')[4].split('"')[0]
        theirs = await b.get("/templates", headers=h)
        assert "Raffle" in mine and "Raffle" not in theirs.text
        assert (await b.get(f"/templates/{tid}", headers=h)).status_code == 404
        await b.post(f"/templates/{tid}/delete", headers=h)
        assert "Raffle" in (await a.get("/templates", headers=h)).text


async def test_another_events_undo_and_announce_do_not_reach_here(env: Env) -> None:
    h = env.writer()
    async with env.client("a.example.test") as a, env.client("b.example.test") as b:
        item = await add(a, h, ends_at=at(120))
        done = await a.post(f"/items/{item['id']}/cancel", data={"revision": "1"}, headers=h)
        token = done.headers["location"].split("undo=")[1]
        env.store.calls.clear()
        undo = await b.post(f"/undo/{token}", headers=h)
        announced = await b.post(f"/api/agenda/items/{item['id']}/announce", json={}, headers=h)
        on_a = (await a.get(done.headers["location"].removeprefix("/agenda"), headers=h)).text
    assert undo.status_code == 404 and announced.status_code == 404
    assert env.store.calls == []
    assert token in on_a  # still there for its own event


async def test_rls_keeps_every_table_apart(env: Env) -> None:
    class Probe:
        seed = staticmethod(lambda t, m: _seed(t, m))
        read = staticmethod(lambda t: _read(t))

    async def _seed(tenant: str, marker: str) -> None:
        async with env.db.tenant(tenant) as conn:
            await conn.execute("INSERT INTO agenda_state DEFAULT VALUES ON CONFLICT DO NOTHING")
            await conn.execute("INSERT INTO agenda_kinds (key, name) VALUES ($1, $1)", marker)
            await conn.execute(
                "INSERT INTO agenda_items (id, title, kind, starts_at, planned_starts_at,"
                " visibility) VALUES ($1, $1, 'other', $2, $2, 'public')",
                marker,
                env.clock[0],
            )
            await conn.execute(
                "INSERT INTO agenda_timers (item_id, kind, due_at) VALUES ($1, 'started', $2)",
                marker,
                env.clock[0],
            )
            await conn.execute("INSERT INTO agenda_sessions (session_id) VALUES ($1)", marker)
            await conn.execute(
                "INSERT INTO agenda_templates (id, name, kind, visibility)"
                " VALUES ($1, $1, 'other', 'public')",
                marker,
            )
            await conn.execute(
                "INSERT INTO agenda_changes (item_id, revision, action, actor_name)"
                " VALUES ($1, 1, 'added', 'x')",
                marker,
            )
            await conn.execute(
                "INSERT INTO agenda_undo (id, actor_user_id, steps, expires_at)"
                " VALUES ($1, 'u', '[]', $2)",
                marker,
                env.clock[0],
            )
            await conn.execute("INSERT INTO agenda_outbox (event) VALUES ($1)", marker)

    async def _read(tenant: str) -> set[str]:
        async with env.db.tenant(tenant) as conn:
            kinds = await conn.fetch("SELECT key FROM agenda_kinds")
            items = await conn.fetch("SELECT id FROM agenda_items")
            timers = await conn.fetch("SELECT item_id FROM agenda_timers")
            sessions = await conn.fetch("SELECT session_id FROM agenda_sessions")
            kept = await conn.fetch("SELECT id FROM agenda_templates")
            logged = await conn.fetch("SELECT item_id FROM agenda_changes")
            undos = await conn.fetch("SELECT id FROM agenda_undo")
            pending = await conn.fetch("SELECT event FROM agenda_outbox")
            states = await conn.fetchval("SELECT count(*) FROM agenda_state")
        assert states == 1
        return (
            {r["key"] for r in kinds}
            | {r["id"] for r in items}
            | {r["item_id"] for r in timers}
            | {r["session_id"] for r in sessions}
            | {r["id"] for r in kept}
            | {r["item_id"] for r in logged}
            | {r["id"] for r in undos}
            | {r["event"] for r in pending}
        )

    await assert_tenant_isolation(Probe())
