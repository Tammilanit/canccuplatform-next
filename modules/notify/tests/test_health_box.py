"""Can attendees get notifications? (#782 part C, plan D15, sheet 01): https, the push key, the
devices registered and the last delivery, each with what to do, for `notify.topics.write`."""

from __future__ import annotations

from typing import Any

import httpx
from conftest import Env
from test_delivery import statuses
from topics import reminder, schedule

PHONE = {"user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148"}
ANDROID = {"user-agent": "Mozilla/5.0 (Linux; Android 15) Chrome/130.0 Mobile Safari/537.36"}
PC = {"user-agent": "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/133.0"}
HEALTH = "/api/notify/delivery-health"


async def health(env: Env, *, https: bool = False, host: str = "a.example.test") -> Any:
    scheme = "https" if https else "http"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=env.app), base_url=f"{scheme}://{host}"
    ) as c:
        r = await c.get(HEALTH, headers=env.admin())
    assert r.status_code == 200, r.text
    return r.json()


async def test_a_phone_s_subscription_counts_as_a_phone_and_no_user_agent_is_kept(
    env: Env,
) -> None:
    await env.register(schedule())
    await env.subscribe("p1", headers=PHONE)
    await env.subscribe("p2", headers=ANDROID)
    await env.subscribe("p3", headers=PHONE)
    await env.subscribe("c1", headers=PC)
    async with env.db.tenant("ev-a") as conn:
        rows = [dict(r) for r in await conn.fetch("SELECT * FROM notify_subscriptions")]
    assert sorted(r["device"] for r in rows) == ["pc", "phone", "phone", "phone"]
    assert not any("Mozilla" in str(v) for r in rows for v in r.values())
    assert (await health(env))["devices"] == {"phones": 3, "pcs": 1}


async def test_a_refused_push_keeps_its_reason(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    env.push.answers["https://push.example.test/send/g1"] = 403
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    assert await statuses(env) == ["failed"]
    last = (await health(env))["last_delivery"]
    assert last["status"] == "failed"
    assert last["error"] == "the push service refused it (403)" and last["at"]


async def test_the_last_delivery_is_ok_when_it_was_sent(env: Env) -> None:
    await env.register(schedule())
    assert (await health(env))["last_delivery"] is None
    await env.subscribe("g1")
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    last = (await health(env))["last_delivery"]
    assert last["status"] == "sent" and last["error"] is None


async def test_https_is_told_from_plain_http_and_the_push_key_is_set(env: Env) -> None:
    plain = await health(env)
    assert plain["https"] is False and plain["push_key"] is True
    assert (await health(env, https=True))["https"] is True


async def test_health_needs_the_topics_right(env: Env) -> None:
    async with env.client() as c:
        reader = await c.get(HEALTH, headers=env.rights.sign_in("u_s", "notify.stats.read"))
        nobody = await c.get(HEALTH)
    assert reader.status_code == 403 and nobody.status_code == 401


async def test_another_event_s_devices_and_deliveries_are_never_counted(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("b1", headers=PHONE, host="b.example.test")
    env.push.answers["https://push.example.test/send/b1"] = 500
    await env.emit("ev-b", "agenda.reminder.triggered", reminder())
    mine = await health(env)
    assert mine["devices"] == {"phones": 0, "pcs": 0} and mine["last_delivery"] is None


async def test_the_page_shows_the_box_with_what_to_do(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("p1", headers=PHONE)
    async with env.client() as c:
        page = (await c.get("/admin/topics", headers=env.admin())).text
        reader = await c.get(
            "/admin/topics", headers=env.rights.sign_in("u_s", "notify.stats.read")
        )
    box = page.split('id="health"')[1].split("</section>")[0]
    assert "Can attendees get notifications?" in box
    assert "Missing, so phones can&#x27;t register." in box
    assert "Open the event on its https address." in box
    assert "1 phone, 0 PCs." in box and "Nothing sent yet." in box
    assert 'id="health"' not in reader.text
