"""Subscribing, managing and claiming push subscriptions (contracts/notify.md, Web Push)."""

from __future__ import annotations

import hashlib
from typing import Any

from conftest import Env
from topics import play, schedule


def bearer(token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"}


async def test_the_push_key_is_the_vapid_public_key(env: Env) -> None:
    async with env.client() as c:
        response = await c.get("/api/notify/push-key")
    assert response.json() == {"vapid_public_key": env.deps.push.vapid.public_key}


async def test_a_guest_subscribes_to_event_wide_parts_and_gets_a_token_once(env: Env) -> None:
    await env.register(schedule())
    await env.register(play())
    created = await env.subscribe("g1")
    assert created.status_code == 201, created.text
    sub = created.json()
    assert sub["kind"] == "guest" and len(sub["subscription_token"]) >= 32
    assert sub["preferences"] == {"schedule": {"event": True}, "play": {"personal": False}}
    assert "endpoint" not in sub and "keys" not in sub
    async with env.db.tenant("ev-a") as conn:
        row = await conn.fetchrow("SELECT * FROM notify_subscriptions")
    # The browser's keys are sealed and the token is kept only as a hash.
    assert row["keys_sealed"].startswith("cs1.") and "p256dh" not in row["keys_sealed"]
    assert row["token_hash"] == hashlib.sha256(sub["subscription_token"].encode()).hexdigest()
    async with env.client() as c:
        again = await c.get(
            f"/api/notify/subscriptions/{sub['id']}", headers=bearer(sub["subscription_token"])
        )
    assert again.status_code == 200 and "subscription_token" not in again.json()
    personal = await env.subscribe("g2", preferences={"play": {"personal": True}})
    assert personal.status_code == 401 and personal.json()["error"]["code"] == "sign_in_required"


async def test_bad_subscriptions_are_refused(env: Env) -> None:
    await env.register(schedule())
    good = env.push.browser("g1").subscription()
    cases: list[Any] = [
        {"push": {**good, "endpoint": "http://push.example.test/x"}},
        {"push": {**good, "endpoint": "https://10.0.0.5/x"}},
        {"push": {**good, "endpoint": "https://127.1/x"}},
        {"push": {**good, "endpoint": "https://0x7f.0.0.1/x"}},
        {"push": {**good, "endpoint": "https://2130706433./x"}},
        {"push": {**good, "endpoint": "https://tenants:443/x"}},
        {"push": {**good, "endpoint": "https://push.example.test:8080/x"}},
        {"push": {**good, "keys": {"p256dh": "AAAA", "auth": good["keys"]["auth"]}}},
        {"push": {**good, "keys": {**good["keys"], "auth": "short"}}},
        {"push": good, "preferences": {"nope": {"event": True}}},
        {"push": good, "preferences": {"schedule": {"personal": True}}},
        {"push": good, "preferences": {"schedule": {"event": "yes"}}},
        {"push": "x"},
    ]
    async with env.client() as c:
        for body in cases:
            response = await c.post("/api/notify/subscriptions", json=body)
            assert response.status_code == 400, body


async def test_only_the_owner_manages_a_subscription(env: Env) -> None:
    await env.register(schedule())
    guest = (await env.subscribe("g1")).json()
    user = (await env.subscribe("u1", env.rights.sign_in("u_a"))).json()
    assert user["kind"] == "user"
    url = f"/api/notify/subscriptions/{guest['id']}"
    async with env.client() as c:
        assert (await c.get(url)).status_code == 404
        assert (await c.get(url, headers=bearer("x" * 43))).status_code == 404
        assert (await c.get(url, headers=bearer(user["subscription_token"]))).status_code == 404
        assert (await c.get(url, headers=env.rights.sign_in("u_a"))).status_code == 404
        mine = f"/api/notify/subscriptions/{user['id']}"
        assert (await c.get(mine, headers=env.rights.sign_in("u_a"))).status_code == 200
        assert (await c.get(mine, headers=env.rights.sign_in("u_b"))).status_code == 404
        patched = await c.patch(
            url,
            json={"preferences": {"schedule": {"event": False}}},
            headers=bearer(guest["subscription_token"]),
        )
        assert patched.json()["preferences"] == {"schedule": {"event": False}}
        assert (await c.delete(url, headers=bearer(guest["subscription_token"]))).status_code == 204
        assert (await c.get(url, headers=bearer(guest["subscription_token"]))).status_code == 404
    async with env.client("b.example.test") as b:
        other = f"/api/notify/subscriptions/{user['id']}"
        assert (await b.get(other, headers=env.rights.sign_in("u_a"))).status_code == 404


async def test_the_same_endpoint_is_replaced_only_by_its_owner(env: Env) -> None:
    await env.register(schedule())
    first = (await env.subscribe("g1")).json()
    taken = await env.subscribe("g1")
    assert taken.status_code == 409 and taken.json()["error"]["code"] == "subscription_exists"
    assert (await env.subscribe("g1", env.rights.sign_in("u_a"))).status_code == 409
    replaced = await env.subscribe("g1", bearer(first["subscription_token"]))
    assert replaced.status_code == 201 and replaced.json()["id"] != first["id"]
    async with env.client() as c:
        old = f"/api/notify/subscriptions/{first['id']}"
        assert (await c.get(old, headers=bearer(first["subscription_token"]))).status_code == 404
    mine = (await env.subscribe("u1", env.rights.sign_in("u_a"))).json()
    again = await env.subscribe("u1", env.rights.sign_in("u_a"))
    assert again.status_code == 201 and again.json()["id"] != mine["id"]
    # Another event's subscription of the same browser is its own.
    assert (await env.subscribe("g1", host="b.example.test")).status_code == 201


async def test_claiming_makes_a_guest_subscription_the_users(env: Env) -> None:
    await env.register(play())
    guest = (await env.subscribe("g1")).json()
    url = f"/api/notify/subscriptions/{guest['id']}/claim"
    token = bearer(guest["subscription_token"])
    async with env.client() as c:
        assert (await c.post(url, headers=token)).status_code == 401
        wrong = {**env.rights.sign_in("u_a"), **bearer("y" * 43)}
        assert (await c.post(url, headers=wrong)).status_code == 404
        claimed = await c.post(url, headers={**env.rights.sign_in("u_a"), **token})
        assert claimed.status_code == 200 and claimed.json()["kind"] == "user"
        on = await c.patch(
            f"/api/notify/subscriptions/{guest['id']}",
            json={"preferences": {"play": {"personal": True}}},
            headers=env.rights.sign_in("u_a"),
        )
        assert on.json()["preferences"] == {"play": {"personal": True}}


async def test_info_page_mode_closes_subscribing_to_guests_only(env: Env) -> None:
    await env.register(schedule())
    env.contexts["ev-a"]["info_page_mode"] = "sign_in"
    closed = await env.subscribe("g1")
    assert closed.status_code == 403 and closed.json()["error"]["code"] == "info_pages_closed"
    assert (await env.subscribe("u1", env.rights.sign_in("u_a"))).status_code == 201
    env.contexts["ev-a"]["info_page_mode"] = "venue_only"
    assert (await env.subscribe("g1")).status_code == 403  # the test client is off-site


async def test_the_inbox_through_a_token_follows_the_subscriptions_owner(env: Env) -> None:
    await env.register(schedule())
    await env.register(play())
    from topics import reminder

    guest = (await env.subscribe("g1")).json()
    user = (await env.subscribe("u1", env.rights.sign_in("u_a"))).json()
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(), id="e1")
    await env.emit("ev-a", "agenda.reminder.triggered", reminder("attendees"), id="e2")
    data = {"user_ids": ["u_a"], "game": "Chess", "host": "Host", "at": "2026-11-20T18:00:00Z"}
    await env.emit("ev-a", "games.session.invited", data, id="e3")
    async with env.client() as c:
        as_guest = await c.get("/api/notify/inbox", headers=bearer(guest["subscription_token"]))
        as_user = await c.get("/api/notify/inbox", headers=bearer(user["subscription_token"]))
        assert (await c.get("/api/notify/inbox", headers=bearer("z" * 43))).status_code == 401
        env.contexts["ev-a"]["info_page_mode"] = "sign_in"
        closed = await c.get("/api/notify/inbox", headers=bearer(guest["subscription_token"]))
    assert [n["audience"] for n in as_guest.json()["notifications"]] == ["public"]
    assert sorted(n["audience"] for n in as_user.json()["notifications"]) == [
        "attendees",
        "public",
    ]
    assert closed.json()["notifications"] == []
