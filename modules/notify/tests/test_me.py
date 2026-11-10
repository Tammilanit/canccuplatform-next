"""A person's own settings, follows and privacy (contracts/notify.md, Per-person channels and
follows; The hub, Privacy)."""

from __future__ import annotations

from typing import Any

import httpx
from conftest import Env
from test_checkin import code
from topics import game, play, schedule, surge

PLAY_DM = {"play": {"personal": {"discord_dm": True}}}


async def call(env: Env, method: str, path: str, user: str | None, **kw: Any) -> httpx.Response:
    headers = env.rights.sign_in(user) if user else {}
    async with env.client() as c:
        return await c.request(method, path, headers=headers, **kw)


async def test_me_reads_and_sets_the_callers_own_choices(env: Env) -> None:
    await env.register(play())
    assert (await call(env, "GET", "/api/notify/me", None)).status_code == 401
    r = await call(env, "GET", "/api/notify/me", "u_a")
    assert r.json() == {"dm_fallback": True, "channels": {}}
    r = await call(env, "PATCH", "/api/notify/me", "u_a", json={"channels": PLAY_DM})
    assert r.json() == {"dm_fallback": True, "channels": PLAY_DM}
    body = {"dm_fallback": False, "channels": {"play": {"personal": {"push": False}}}}
    r = await call(env, "PATCH", "/api/notify/me", "u_a", json=body)
    both = {"play": {"personal": {"discord_dm": True, "push": False}}}
    assert r.json() == {"dm_fallback": False, "channels": both}
    assert (await call(env, "GET", "/api/notify/me", "u_a")).json()["channels"] == both
    assert (await call(env, "GET", "/api/notify/me", "u_b")).json()["channels"] == {}


async def test_me_refuses_what_the_topics_do_not_offer(env: Env) -> None:
    reg = play()
    reg["parts"]["personal"].update(channels=["push"], defaults={"push": True})
    await env.register(reg)
    bodies: list[dict[str, Any]] = [
        {"dm_fallback": "yes"},
        {"channels": {"nope": {"personal": {"push": True}}}},
        {"channels": {"play": {"event": {"push": True}}}},
        {"channels": {"play": {"personal": {"discord_dm": True}}}},
        {"channels": {"play": {"personal": {"push": 1}}}},
        {"channels": []},
    ]
    for body in bodies:
        r = await call(env, "PATCH", "/api/notify/me", "u_a", json=body)
        assert r.status_code == 400, body
    assert (await call(env, "PATCH", "/api/notify/me", None, json={})).status_code == 401


async def test_a_push_switched_off_by_the_person_reaches_no_phone(env: Env) -> None:
    await env.register(play())
    await env.subscribe("a1", env.rights.sign_in("u_a"), {"play": {"personal": True}})
    off = {"channels": {"play": {"personal": {"push": False}}}}
    await call(env, "PATCH", "/api/notify/me", "u_a", json=off)
    data = {"user_ids": ["u_a"], "game": "Chess", "host": "Host", "at": "2026-11-20T18:00:00Z"}
    await env.emit("ev-a", "games.session.invited", data)
    assert env.push.to("a1") == []


async def test_follows_need_a_session_and_a_followable_topic(env: Env) -> None:
    await env.register(schedule())
    await env.register(game())
    path = "/api/notify/me/follows/game/g_1"
    r = await call(env, "PUT", path, None)
    assert r.status_code == 401 and r.json()["error"]["code"] == "sign_in_required"
    r = await call(env, "PUT", "/api/notify/me/follows/schedule/g_1", "u_a")
    assert r.status_code == 400 and r.json()["error"]["code"] == "not_followable"
    assert (await call(env, "PUT", "/api/notify/me/follows/game/bad id", "u_a")).status_code == 400
    first = await call(env, "PUT", path, "u_a")
    again = await call(env, "PUT", path, "u_a")
    assert (first.status_code, again.status_code) == (201, 200) and first.json() == again.json()
    assert first.json()["topic"] == "game" and first.json()["entity_id"] == "g_1"
    r = await call(env, "GET", "/api/notify/me/follows", "u_a")
    assert [f["entity_id"] for f in r.json()["follows"]] == ["g_1"]
    assert (await call(env, "GET", "/api/notify/me/follows", "u_b")).json() == {"follows": []}
    assert (await call(env, "DELETE", path, "u_a")).status_code == 204
    assert (await call(env, "DELETE", path, "u_a")).status_code == 204
    assert (await call(env, "GET", "/api/notify/me/follows", "u_a")).json() == {"follows": []}
    assert (await call(env, "DELETE", path, None)).status_code == 401


async def test_at_most_200_follows_per_person(env: Env) -> None:
    await env.register(game())
    async with env.db.tenant("ev-a") as conn:
        await conn.executemany(
            "INSERT INTO notify_follows (user_id, topic, entity_id, created_at)"
            " VALUES ('u_a', 'game', $1, now())",
            [(f"g_{n}",) for n in range(200)],
        )
    r = await call(env, "PUT", "/api/notify/me/follows/game/g_new", "u_a")
    assert r.status_code == 409 and r.json()["error"]["code"] == "follow_limit"
    assert (await call(env, "PUT", "/api/notify/me/follows/game/g_1", "u_a")).status_code == 200


async def test_followers_get_the_entitys_notifications(env: Env) -> None:
    await env.register(game())
    await call(env, "PUT", "/api/notify/me/follows/game/g_1", "u_a")
    await call(env, "PUT", "/api/notify/me/follows/game/g_2", "u_b")
    await env.subscribe("a1", env.rights.sign_in("u_a"), {"game": {"personal": True}})
    await env.emit("ev-a", "games.surge.started", surge("g_1"))
    [note] = (await call(env, "GET", "/api/notify/inbox", "u_a")).json()["notifications"]
    assert note["entity"] == {"type": "game", "id": "g_1"} and note["audience"] == "personal"
    assert note["title"] == "Chess is popular now"
    assert (await call(env, "GET", "/api/notify/inbox", "u_b")).json()["notifications"] == []
    assert [p["id"] for p in env.push.to("a1")] == [note["id"]]


async def test_merged_entities_carry_their_follows_and_removed_ones_drop_them(env: Env) -> None:
    await env.register(game())
    for user, entity in (("u_a", "g_1"), ("u_a", "g_2"), ("u_b", "g_1")):
        await call(env, "PUT", f"/api/notify/me/follows/game/{entity}", user)
    merged = {"game_id": "g_1", "into_game_id": "g_2", "catalogue_version": 2}
    await env.emit("ev-a", "games.game.merged", merged, id="m1")
    for user in ("u_a", "u_b"):
        r = await call(env, "GET", "/api/notify/me/follows", user)
        assert [f["entity_id"] for f in r.json()["follows"]] == ["g_2"]
    await env.emit("ev-a", "games.game.removed", {"game_id": "g_2"}, id="m2")
    assert (await call(env, "GET", "/api/notify/me/follows", "u_a")).json() == {"follows": []}


async def seed_person(env: Env, user: str) -> str:
    """Everything Notify may hold on one person; returns their personal notification's id."""
    await env.subscribe(f"{user}-phone", env.rights.sign_in(user), {"play": {"personal": True}})
    await call(env, "PATCH", "/api/notify/me", user, json={"channels": PLAY_DM})
    await call(env, "PUT", "/api/notify/me/follows/game/g_1", user)
    body = {"purpose": "arrival", "code": (await code(env))["code"]}
    assert (await call(env, "POST", "/api/notify/check-ins", user, json=body)).status_code == 201
    data = {"user_ids": [user], "game": "Chess", "host": "Host", "at": "2026-11-20T18:00:00Z"}
    await env.emit("ev-a", "games.session.invited", data, id=f"inv-{user}")
    async with env.db.tenant("ev-a") as conn:
        found: str = await conn.fetchval(
            "SELECT id FROM notify_notifications WHERE user_id = $1", user
        )
    return found


async def test_the_export_holds_everything_on_the_caller_and_nothing_else(env: Env) -> None:
    await env.register(play())
    await env.register(game())
    note = await seed_person(env, "u_a")
    await seed_person(env, "u_b")
    assert (await call(env, "GET", "/api/notify/me/export", None)).status_code == 401
    out = (await call(env, "GET", "/api/notify/me/export", "u_a")).json()
    assert [s["kind"] for s in out["subscriptions"]] == ["user"]
    assert "endpoint" not in str(out) and "keys" not in str(out)
    assert out["me"] == {"dm_fallback": True, "channels": PLAY_DM}
    assert [(f["topic"], f["entity_id"]) for f in out["follows"]] == [("game", "g_1")]
    assert [n["id"] for n in out["notifications"]] == [note]
    assert [c["purpose"] for c in out["check_ins"]] == ["arrival"]


async def test_delete_me_removes_everything_on_the_caller_and_ends_pushes(env: Env) -> None:
    await env.register(play())
    await env.register(game())
    await seed_person(env, "u_a")
    await seed_person(env, "u_b")
    assert (await call(env, "DELETE", "/api/notify/me", None)).status_code == 401
    assert (await call(env, "DELETE", "/api/notify/me", "u_a")).status_code == 204
    out = (await call(env, "GET", "/api/notify/me/export", "u_a")).json()
    assert out == {
        "subscriptions": [],
        "me": {"dm_fallback": True, "channels": {}},
        "follows": [],
        "notifications": [],
        "check_ins": [],
    }
    async with env.db.tenant("ev-a") as conn:
        left = await conn.fetchval(
            "SELECT count(*) FROM notify_deliveries WHERE recipient = 'user:u_a'"
        )
    assert left == 0
    other = (await call(env, "GET", "/api/notify/me/export", "u_b")).json()
    assert len(other["subscriptions"]) == len(other["notifications"]) == 1
    data = {"user_ids": ["u_a"], "game": "Chess", "host": "Host", "at": "2026-11-20T18:00:00Z"}
    await env.emit("ev-a", "games.session.invited", data, id="after")
    assert len(env.push.to("u_a-phone")) == 1  # only the one before the delete
