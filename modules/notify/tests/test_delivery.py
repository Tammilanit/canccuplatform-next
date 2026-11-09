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


async def test_the_sender_loop_finishes_what_a_failed_run_left(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    pusher = env.deps.push

    class Down:
        vapid = pusher.vapid

        async def send(self, *args: Any, **kwargs: Any) -> int:
            raise RuntimeError("the sender crashed")

    env.deps.push = Down()  # type: ignore[assignment]
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    assert await statuses(env) == ["pending"]
    env.deps.push = pusher
    assert await delivery.tick(env.deps) == 1
    assert await statuses(env) == ["sent"] and len(env.push.to("g1")) == 1
    async with env.db.platform() as conn:
        assert await conn.fetch("SELECT * FROM notify_delivery_tenants") == []
    assert await delivery.tick(env.deps) == 0


async def test_an_expired_notification_is_not_pushed(env: Env) -> None:
    await env.register(schedule())
    await env.subscribe("g1")
    env.deps.push, real = None, env.deps.push  # type: ignore[assignment]
    await env.emit("ev-a", "agenda.reminder.triggered", reminder())
    env.deps.push = real
    env.clock[0] += timedelta(hours=2)
    await delivery.tick(env.deps)
    assert await statuses(env) == ["skipped"] and env.push.received == []
