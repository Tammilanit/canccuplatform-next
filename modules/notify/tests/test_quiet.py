"""Quiet hours from the run-of-show (contracts/notify.md, Delivery rules, Quiet hours): the
mirror of the agenda's `quiet_hours` items, holding and releasing."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from conftest import Env
from test_delivery import raise_alert, statuses
from topics import alert, quiet, reminder, schedule

from canccu_notify import delivery
from canccu_notify import quiet as quiet_hours


async def agenda(env: Env, type: str, version: int, n: int, **data: Any) -> None:
    await env.emit("ev-a", f"agenda.{type}", {"agenda_version": version, **data}, id=f"ag-{n}")


async def mirrored(env: Env) -> list[str]:
    async with env.db.tenant("ev-a") as conn:
        rows = await conn.fetch("SELECT item_id FROM notify_quiet_hours ORDER BY 1")
    return [r["item_id"] for r in rows]


async def test_running_quiet_hours_hold_non_urgent_pushes_only(env: Env) -> None:
    await env.register(alert())
    await env.subscribe("g1")
    await agenda(env, "item.added", 1, 1, item=quiet())
    await raise_alert(env, 1)
    assert env.push.to("g1") == [] and await statuses(env) == ["held"]
    await raise_alert(env, 2, urgent=True)
    assert [p["urgent"] for p in env.push.to("g1")] == [True]


async def test_when_they_end_the_newest_held_per_topic_goes_out(env: Env) -> None:
    await env.register(alert())
    await env.register(schedule())
    await env.subscribe("g1")
    await agenda(env, "item.added", 1, 1, item=quiet(end=20))
    await raise_alert(env, 1)
    env.clock[0] += timedelta(minutes=1)
    await raise_alert(env, 2)
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(), id="r1")
    assert env.push.to("g1") == []
    assert await delivery.tick(env.deps) == 0  # still quiet
    env.clock[0] += timedelta(minutes=20)
    assert await delivery.tick(env.deps) == 2
    assert sorted(p["topic"] for p in env.push.to("g1")) == ["alert", "schedule"]
    assert await statuses(env) == ["skipped", "sent", "sent"]  # the older alert stays in the inbox


async def test_an_expired_held_notification_is_not_sent(env: Env) -> None:
    await env.register(alert())  # expires 30 minutes after it is made
    await env.subscribe("g1")
    await agenda(env, "item.added", 1, 1, item=quiet(end=45))
    await raise_alert(env, 1)
    env.clock[0] += timedelta(minutes=46)
    await delivery.tick(env.deps)
    assert env.push.to("g1") == [] and await statuses(env) == ["skipped"]


async def test_crew_cancelled_and_other_items_hold_nothing(env: Env) -> None:
    await env.register(alert())
    await env.subscribe("g1")
    await agenda(env, "item.added", 1, 1, item=quiet("q1", visibility="crew"))
    await agenda(env, "item.added", 2, 2, item=quiet("q2"))
    await agenda(env, "item.cancelled", 3, 3, item=quiet("q2", status="cancelled"))
    await agenda(env, "item.added", 4, 4, item=quiet("q3", start=5))  # not running yet
    await agenda(env, "item.added", 5, 5, item=quiet("q4", kind="meal"))
    await raise_alert(env, 1)
    assert len(env.push.to("g1")) == 1
    assert await mirrored(env) == ["q1", "q2", "q3"]


async def test_a_change_of_kind_or_a_removal_ends_them(env: Env) -> None:
    await env.register(alert())
    await env.subscribe("g1")
    await agenda(env, "item.added", 1, 1, item=quiet("q1"))
    await agenda(env, "item.added", 2, 2, item=quiet("q2"))
    await agenda(env, "item.changed", 3, 3, item=quiet("q1", kind="other"), changed=["kind"])
    await agenda(env, "item.removed", 4, 4, item_id="q2", visibility="public")
    assert await mirrored(env) == []
    await raise_alert(env, 1)
    assert len(env.push.to("g1")) == 1


async def test_a_delay_moves_them(env: Env) -> None:
    await env.register(alert())
    await env.subscribe("g1")
    await agenda(env, "item.added", 1, 1, item=quiet(start=-10, end=20))
    await agenda(env, "item.delayed", 2, 2, item=quiet(start=-10, end=-1), minutes=-21)
    await raise_alert(env, 1)
    assert len(env.push.to("g1")) == 1


async def test_a_version_jump_or_a_clone_reads_the_agenda_again(env: Env) -> None:
    env.agenda.answers["ev-a"] = {"agenda_version": 5, "items": [quiet("q9"), reminder()["item"]]}
    await agenda(env, "item.added", 3, 1, item=quiet("q1"))  # never seen: read it all
    assert env.agenda.reads == ["ev-a"] and await mirrored(env) == ["q9"]
    await agenda(env, "item.added", 4, 2, item=quiet("old"))  # older than the read: ignored
    await agenda(env, "item.added", 6, 3, item=quiet("q6"))
    assert env.agenda.reads == ["ev-a"] and await mirrored(env) == ["q6", "q9"]
    env.agenda.answers["ev-a"] = {"agenda_version": 9, "items": []}
    await agenda(env, "item.added", 8, 4, item=quiet("q8"))  # 7 was missed
    assert len(env.agenda.reads) == 2 and await mirrored(env) == []
    env.agenda.answers["ev-a"] = {"agenda_version": 10, "items": [quiet("c1")]}
    data = {"source_tenant_id": "ev-b", "shift_seconds": 0, "item_count": 1, "kinds_version": 1}
    await agenda(env, "items.cloned", 10, 5, **data)
    assert await mirrored(env) == ["c1"]


async def test_an_unreachable_agenda_keeps_the_last_mirror(env: Env) -> None:
    await env.register(alert())
    await env.subscribe("g1")
    await agenda(env, "item.added", 1, 1, item=quiet("q1"))
    env.agenda.down = True
    await agenda(env, "item.added", 5, 2, item=reminder()["item"])
    assert await mirrored(env) == ["q1"]
    await raise_alert(env, 1)
    assert env.push.to("g1") == []


async def test_start_up_reads_every_mirrored_agenda_again(env: Env) -> None:
    await agenda(env, "item.added", 1, 1, item=quiet("q1"))
    env.agenda.answers["ev-a"] = {"agenda_version": 4, "items": [quiet("q2", end=90)]}
    await quiet_hours.refresh_all(env.deps)
    assert await mirrored(env) == ["q2"]
    env.agenda.down = True
    await quiet_hours.refresh_all(env.deps)  # logged, nothing raised, the mirror kept
    assert await mirrored(env) == ["q2"]
