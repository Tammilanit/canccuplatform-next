"""The kind list (contracts/agenda.md, Kinds)."""

from __future__ import annotations

from conftest import Env, at


async def test_a_new_event_has_the_starter_set_at_version_0(env: Env) -> None:
    async with env.client() as c:
        body = (await c.get("/api/agenda/kinds")).json()
    assert body["kinds_version"] == 0
    keys = [k["key"] for k in body["kinds"]]
    assert keys == ["doors", "ceremony", "tournament", "meal", "quiet_hours", "activity", "other"]
    assert all(k["builtin"] and k["revision"] == 1 for k in body["kinds"])


async def test_add_replace_and_remove_a_kind(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        added = await c.put("/api/agenda/kinds/cosplay", json={"name": "Cosplay"}, headers=h)
        assert added.status_code == 201
        assert added.json() == {
            "key": "cosplay",
            "name": "Cosplay",
            "builtin": False,
            "reminder_leads_minutes": None,
            "notify": None,
            "revision": 1,
        }
        again = await c.put("/api/agenda/kinds/cosplay", json={"name": "X"}, headers=h)
        assert again.json()["error"]["code"] == "kind_exists"
        replaced = await c.put(
            "/api/agenda/kinds/cosplay",
            json={"name": "Cosplay show", "revision": 1, "notify": ["push"]},
            headers=h,
        )
        assert replaced.status_code == 200
        assert replaced.json()["revision"] == 2
        stale = await c.put(
            "/api/agenda/kinds/cosplay", json={"name": "Old", "revision": 1}, headers=h
        )
        assert stale.json()["error"]["code"] == "version_conflict"
        assert (
            await c.delete("/api/agenda/kinds/cosplay?revision=1", headers=h)
        ).status_code == 409
        assert (
            await c.delete("/api/agenda/kinds/cosplay?revision=2", headers=h)
        ).status_code == 204
        assert (await c.get("/api/agenda/kinds")).json()["kinds_version"] == 3
    events = [(e["type"], e["data"].get("kinds_version")) for e in env.events()]
    assert events == [
        ("agenda.kind.saved", 1),
        ("agenda.kind.saved", 2),
        ("agenda.kind.removed", 3),
    ]
    assert env.events()[2]["data"] == {
        "kind_key": "cosplay",
        "kinds_version": 3,
        "actor_user_id": "u_org",
    }


async def test_other_is_required_and_a_kind_in_use_stays(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        other = await c.delete("/api/agenda/kinds/other?revision=1", headers=h)
        assert other.json()["error"]["code"] == "kind_required"
        await c.post(
            "/api/agenda/items",
            json={"title": "Lunch", "kind": "meal", "starts_at": at(60), "visibility": "public"},
            headers=h,
        )
        used = await c.delete("/api/agenda/kinds/meal?revision=1", headers=h)
        assert used.json()["error"]["code"] == "kind_in_use"


async def test_kind_writes_need_the_right_and_a_valid_key(env: Env) -> None:
    async with env.client() as c:
        anon = await c.put("/api/agenda/kinds/x", json={"name": "X"})
        assert anon.status_code == 401
        reader = env.rights.sign_in("u_crew", "agenda.crew.read")
        assert (
            await c.put("/api/agenda/kinds/x", json={"name": "X"}, headers=reader)
        ).status_code == 403
        bad = await c.put("/api/agenda/kinds/Bad-Key", json={"name": "X"}, headers=env.writer())
        assert bad.json()["error"]["code"] == "invalid_request"
