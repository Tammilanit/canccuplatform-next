"""Send a test to the crew (#782 part C, plan D16, Q7; the lead's comment of 2026-11-23, item 2):
a push to the devices of everyone admin names as holding a role, never to all attendees."""

from __future__ import annotations

from typing import Any

from conftest import Env
from topics import schedule

from canccu_notify.crew_test import TOPIC

TEST = "/api/notify/test/crew"


async def send(env: Env, headers: dict[str, str] | None = None) -> Any:
    async with env.client() as c:
        return await c.post(TEST, headers=headers or env.admin())


async def test_the_test_goes_to_each_role_holder_s_devices(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("crew-phone", headers=env.rights.sign_in("u_crew"))
    await env.subscribe("crew-pc", headers=env.rights.sign_in("u_crew"))
    await env.subscribe("org-phone", headers=env.rights.sign_in("u_org"))
    r = await send(env)
    assert r.status_code == 200, r.text
    assert r.json() == {"recipients": 2, "sent": 3, "failed": 0, "queued": 0}
    assert env.crew.asked == ["ev-a"]
    pushed = env.push.to("crew-phone") + env.push.to("crew-pc") + env.push.to("org-phone")
    assert [p["topic"] for p in pushed] == [TOPIC] * 3 and all(p["urgent"] for p in pushed)


async def test_never_a_guest_or_a_member_without_a_role(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("guest")
    await env.subscribe("member", headers=env.rights.sign_in("u_member"))
    await env.subscribe("crew", headers=env.rights.sign_in("u_crew"))
    r = await send(env)
    assert r.json() == {"recipients": 1, "sent": 1, "failed": 0, "queued": 0}
    assert env.push.to("guest") == [] and env.push.to("member") == []


async def test_a_second_test_within_a_minute_is_429(env: Env) -> None:
    from datetime import timedelta

    assert (await send(env)).status_code == 200
    again = await send(env)
    assert again.status_code == 429 and again.json()["error"]["code"] == "rate_limited"
    env.clock[0] += timedelta(minutes=1, seconds=1)
    assert (await send(env)).status_code == 200


async def test_the_answer_counts_failed_pushes(env: Env) -> None:
    await env.subscribe("crew-phone", headers=env.rights.sign_in("u_crew"))
    env.push.answers["https://push.example.test/send/crew-phone"] = 403
    assert (await send(env)).json() == {"recipients": 1, "sent": 0, "failed": 1, "queued": 0}


async def test_the_test_is_not_a_kind_and_needs_the_topics_right(env: Env) -> None:
    await env.register(schedule())
    await send(env)
    async with env.client() as c:
        kinds = (await c.get("/api/notify/topic-types", headers=env.admin())).json()
        reader = await c.post(TEST, headers=env.rights.sign_in("u_s", "notify.stats.read"))
    assert TOPIC not in {t["topic_type"]["key"] for t in kinds["topic_types"]}
    assert reader.status_code == 403


async def test_admin_not_answering_is_503(env: Env) -> None:
    env.crew.down = True
    r = await send(env)
    assert r.status_code == 503


async def test_the_page_button_sends_it_and_says_how_it_went(env: Env) -> None:
    await env.subscribe("crew-phone", headers=env.rights.sign_in("u_crew"))
    async with env.client() as c:
        page = await c.get("/admin/topics", headers=env.admin())
        assert 'action="/notify/admin/topics/crew-test"' in page.text
        r = await c.post("/admin/topics/crew-test", headers=env.admin())
        assert r.status_code == 303
        shown = await c.get(r.headers["location"].removeprefix("/notify"), headers=env.admin())
        again = await c.post("/admin/topics/crew-test", headers=env.admin())
        wait = await c.get(again.headers["location"].removeprefix("/notify"), headers=env.admin())
    assert "Test sent to 1 device of 1 person." in shown.text
    assert "One test a minute" in wait.text


async def test_a_backlog_is_on_its_way_not_failed(env: Env) -> None:
    from canccu_kit import tenant_scope

    from canccu_notify import delivery

    await env.register(schedule())
    await env.subscribe("crew-phone", headers=env.rights.sign_in("u_crew"))
    now = env.clock[0]
    with tenant_scope("ev-a"):
        async with env.db.tenant() as conn:
            sub = await conn.fetchval("SELECT id FROM notify_subscriptions LIMIT 1")
            # More than one batch of older pending rows: deliver() takes the oldest 100 first.
            for i in range(150):
                await conn.execute(
                    "INSERT INTO notify_notifications (id, topic, part, audience, user_id, title,"
                    " body, urgent, channels, source_event_id, created_at, expires_at)"
                    " VALUES ($1, 'x', 'personal', 'personal', 'u_old', 't', 'b', false,"
                    " $2, $3, $4, $5)",
                    f"old{i}",
                    ["push"],
                    f"old:{i}",
                    now,
                    now.replace(year=now.year + 1),
                )
            await delivery.queue(
                conn, [(f"old{i}", "user:u_old", "push", sub, None, now) for i in range(150)]
            )
    r = await send(env)
    assert r.status_code == 200, r.text
    assert r.json() == {"recipients": 1, "sent": 0, "failed": 0, "queued": 1}
