"""Who gets a push, the hourly cap and urgent notifications (contracts/notify.md, Delivery rules),
end to end through the fake push service, which decrypts every push it receives."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from conftest import Env
from topics import alert, play, reminder, schedule

from canccu_notify import delivery


async def raise_alert(env: Env, n: int, *, urgent: bool = False, vis: str = "public") -> None:
    data = {"title": f"Alert {n}", "urgent": urgent, "visibility": vis}
    await env.emit("ev-a", "admin.alert.raised", data, id=f"alert-{n}")


async def inbox(env: Env) -> list[Any]:
    async with env.client() as c:
        response = await c.get("/api/notify/inbox", headers=env.rights.sign_in("u_a"))
    notes: list[Any] = response.json()["notifications"]
    return notes


async def statuses(env: Env, tenant: str = "ev-a") -> list[str]:
    async with env.db.tenant(tenant) as conn:
        rows = await conn.fetch("SELECT status FROM notify_deliveries ORDER BY id")
    return [r["status"] for r in rows]


async def test_a_public_reminder_reaches_every_phone_with_the_part_on(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    await env.subscribe("off", preferences={"schedule": {"event": False}})
    await env.subscribe("u1", env.rights.sign_in("u_a"))
    await env.subscribe("other", host="b.example.test")
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    [note] = await inbox(env)
    assert env.push.to("g1") == [{"v": 1, "id": note["id"], "topic": "schedule", "urgent": False}]
    assert len(env.push.to("u1")) == 1
    assert env.push.to("off") == [] and env.push.to("other") == []
    headers = env.push.received[0].headers
    assert headers["urgency"] == "normal" and headers["ttl"] == "3600"  # to starts_at 18:00


async def test_attendee_notifications_reach_members_phones_only(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    await env.subscribe("u1", env.rights.sign_in("u_a"))
    await env.emit("ev-a", "agenda.reminder.triggered", reminder("attendees"))
    assert env.push.to("g1") == [] and len(env.push.to("u1")) == 1


async def test_a_personal_notification_reaches_its_users_phones_with_the_part_on(env: Env) -> None:
    await env.register(play())
    await env.subscribe("a1", env.rights.sign_in("u_a"), {"play": {"personal": True}})
    await env.subscribe("a2", env.rights.sign_in("u_a"), {"play": {"personal": False}})
    await env.subscribe("b1", env.rights.sign_in("u_b"), {"play": {"personal": True}})
    await env.subscribe("g1")
    data = {"user_ids": ["u_a"], "game": "Chess", "host": "Host", "at": "2026-11-20T18:00:00Z"}
    await env.emit("ev-a", "games.session.invited", data)
    assert len(env.push.to("a1")) == 1
    assert env.push.to("a2") == env.push.to("b1") == env.push.to("g1") == []


async def test_no_push_when_the_source_leaves_push_out(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(notify_channels=["discord_dm"]))
    assert env.push.received == [] and await statuses(env) == []


async def test_the_hourly_cap_counts_a_person_once_per_notification(env: Env) -> None:
    await env.register(alert())
    env.settings.values["ev-a"] = {"hourly_cap": 2}
    await env.subscribe("a1", env.rights.sign_in("u_a"))
    await env.subscribe("a2", env.rights.sign_in("u_a"))
    await env.subscribe("g1")
    for n in range(3):
        await raise_alert(env, n)
    # Two phones of one person: each notification counts once, so both phones get two of three.
    assert [len(env.push.to(p)) for p in ("a1", "a2", "g1")] == [2, 2, 2]
    assert (await statuses(env)).count("capped") == 3
    assert len(await inbox(env)) == 3  # the capped one stays in the inbox
    await raise_alert(env, 3, urgent=True)
    assert [p["urgent"] for p in env.push.to("g1")] == [False, False, True]
    assert env.push.received[-1].headers["urgency"] == "high"
    env.clock[0] += timedelta(minutes=61)
    await raise_alert(env, 4)
    assert len(env.push.to("g1")) == 4  # the window has moved on


async def test_a_gone_subscription_is_deleted(env: Env) -> None:
    await env.register(schedule())
    gone = (await env.subscribe("g1")).json()
    await env.subscribe("g2")
    env.push.answers["https://push.example.test/send/g1"] = 410
    env.push.answers["https://push.example.test/send/g2"] = 500
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    async with env.db.tenant("ev-a") as conn:
        ids = [r["id"] for r in await conn.fetch("SELECT id FROM notify_subscriptions")]
    assert gone["id"] not in ids and len(ids) == 1
    assert await statuses(env) == ["failed", "failed"]


async def test_closed_info_pages_stop_pushes_to_guests_only(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    await env.subscribe("u1", env.rights.sign_in("u_a"))
    env.contexts["ev-a"]["info_page_mode"] = "sign_in"
    async with env.client() as c:
        await c.get("/api/notify/topics", headers=env.rights.sign_in("u_a"))  # the mode is seen
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    assert env.push.to("g1") == [] and len(env.push.to("u1")) == 1


async def test_the_sender_loop_finishes_what_a_crashed_run_left(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    env.deps.push, real = None, env.deps.push  # type: ignore[assignment]
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())  # crashes after the claim
    env.deps.push = real
    assert await statuses(env) == ["sending"]
    assert await delivery.tick(env.deps) == 0  # another container may still be sending it
    env.clock[0] += delivery.LEASE + timedelta(seconds=1)
    assert await delivery.tick(env.deps) == 1
    assert await statuses(env) == ["sent"] and len(env.push.to("g1")) == 1
    async with env.db.platform() as conn:
        assert await conn.fetch("SELECT * FROM notify_delivery_tenants") == []
    assert await delivery.tick(env.deps) == 0


async def test_one_broken_row_fails_alone(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    await env.subscribe("g2")
    await env.subscribe("g3")
    async with env.db.tenant("ev-a") as conn:
        await conn.execute(
            "UPDATE notify_subscriptions SET keys_sealed = 'cs1.1.AAAA.AAAA'"
            " WHERE endpoint LIKE '%/g1'"
        )
    real = env.deps.push

    class Flaky:
        vapid = real.vapid

        async def send(self, endpoint: str, *args: Any, **kwargs: Any) -> int:
            if endpoint.endswith("/g2"):
                raise RuntimeError("the client broke")
            return await real.send(endpoint, *args, **kwargs)

    env.deps.push = Flaky()  # type: ignore[assignment]
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    assert sorted(await statuses(env)) == ["failed", "failed", "sent"]
    assert len(env.push.to("g3")) == 1


async def test_a_draft_event_pushes_nothing_to_guests(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    await env.subscribe("u1", env.rights.sign_in("u_a"))
    env.contexts["ev-a"]["status"] = "draft"
    async with env.client() as c:
        await c.get("/api/notify/topics", headers=env.rights.sign_in("u_a"))  # the status is seen
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    assert env.push.to("g1") == [] and len(env.push.to("u1")) == 1


async def test_the_stored_state_follows_the_request_not_a_process_cache(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    async with env.db.tenant("ev-a") as conn:  # another container wrote a newer mode
        await conn.execute("UPDATE notify_event_state SET info_page_mode = 'sign_in'")
    async with env.client() as c:
        await c.get("/api/notify/topics")  # this request sees the mode public again
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    assert len(env.push.to("g1")) == 1


async def test_an_expired_notification_is_not_pushed(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    env.deps.push, real = None, env.deps.push  # type: ignore[assignment]
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    env.deps.push = real
    env.clock[0] += timedelta(hours=2)
    await delivery.tick(env.deps)
    assert await statuses(env) == ["skipped"] and env.push.received == []


async def test_a_phone_that_gets_a_custom_topic_skips_its_bases_push(env: Env) -> None:
    from test_custom import COSPLAY, save

    await env.register(schedule())
    assert (await save(env, "custom_cosplay", COSPLAY)).status_code in (200, 201)
    await env.subscribe("both")
    await env.subscribe("base", preferences={"custom_cosplay": {"event": False}})
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(kind="cosplay"))
    assert [p["topic"] for p in env.push.to("both")] == ["custom_cosplay"]
    assert [p["topic"] for p in env.push.to("base")] == ["schedule"]
    assert sorted(await statuses(env)) == ["sent", "sent", "skipped"]
