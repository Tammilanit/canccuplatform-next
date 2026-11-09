"""The reminder scheduler (contracts/agenda.md, Reminders) on a fake clock."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any

from canccu_kit import Event, tenant_scope
from conftest import NOW, Env, at
from test_items import add

from canccu_agenda import timers


def fired(env: Env) -> list[tuple[str, Any]]:
    """The scheduler's events since the last call: type and lead (or item id)."""
    out: list[tuple[str, Any]] = []
    for e in env.events():
        if e["type"] == "agenda.reminder.triggered":
            out.append((e["type"], e["data"]["lead_minutes"]))
        elif e["type"] in ("agenda.item.started", "agenda.item.ended"):
            out.append((e["type"], e["data"]["item"]["title"]))
    env.store.calls.clear()
    return out


async def run_at(env: Env, minutes: int) -> list[tuple[str, Any]]:
    env.clock[0] = NOW + timedelta(minutes=minutes)
    env.store.calls.clear()
    await timers.tick(env.app.state.deps)
    return fired(env)


async def registered(env: Env) -> list[str]:
    async with env.db.pool.acquire() as conn:
        return [r[0] for r in await conn.fetch("SELECT tenant_id FROM agenda_timer_tenants")]


async def test_reminders_start_and_end_fire_once_at_their_time(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
    assert await registered(env) == ["ev-a"]
    assert await run_at(env, 29) == []
    env.clock[0] = NOW + timedelta(minutes=30)
    await timers.tick(env.app.state.deps)
    (reminder,) = env.events()
    assert reminder["type"] == "agenda.reminder.triggered" and reminder["tenant"] == "ev-a"
    assert reminder["data"]["item"] == item
    assert reminder["data"]["lead_minutes"] == 30
    assert sorted(reminder["data"]["leads_minutes"]) == [10, 30]
    env.store.calls.clear()
    assert await run_at(env, 31) == []  # fired once
    assert await run_at(env, 50) == [("agenda.reminder.triggered", 10)]
    assert await run_at(env, 60) == [("agenda.item.started", "Dinner")]
    assert await run_at(env, 125) == [("agenda.item.ended", "Dinner")]
    assert await registered(env) == []  # nothing left: the scheduler stops visiting it


async def test_a_lead_already_passed_when_added_is_skipped(env: Env) -> None:
    async with env.client() as c:
        await add(c, env.writer(), starts_at=at(20))
    assert await run_at(env, 10) == [("agenda.reminder.triggered", 10)]
    assert await run_at(env, 20) == [("agenda.item.started", "Dinner")]


async def test_leads_follow_item_then_kind_then_event(env: Env) -> None:
    h = env.writer()
    env.settings.values["ev-a"] = {"reminder_leads_minutes": [45]}
    async with env.client() as c:
        await add(c, h, title="Event", starts_at=at(60))
        await add(c, h, title="Own", starts_at=at(60), reminder_leads_minutes=[5])
        await add(c, h, title="None", starts_at=at(60), reminder_leads_minutes=[])
        await c.put(
            "/api/agenda/kinds/doors",
            json={"name": "Doors", "revision": 1, "reminder_leads_minutes": [20]},
            headers=h,
        )
        await add(c, h, title="Kind", kind="doors", starts_at=at(60))
    assert await run_at(env, 15) == [("agenda.reminder.triggered", 45)]
    assert await run_at(env, 40) == [("agenda.reminder.triggered", 20)]
    assert await run_at(env, 55) == [("agenda.reminder.triggered", 5)]


async def test_a_delay_reschedules_and_a_fired_reminder_fires_again_while_ahead(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        assert await run_at(env, 30) == [("agenda.reminder.triggered", 30)]
        env.clock[0] = NOW + timedelta(minutes=35)
        response = await c.post(
            f"/api/agenda/items/{item['id']}/delay",
            json={"revision": 1, "minutes": 15},
            headers=h,
        )
        assert response.status_code == 200
    env.store.calls.clear()
    assert await run_at(env, 45) == [("agenda.reminder.triggered", 30)]  # the new time
    assert await run_at(env, 60) == []  # the old start is no longer a start
    assert await run_at(env, 65) == [("agenda.reminder.triggered", 10)]
    assert await run_at(env, 75) == [("agenda.item.started", "Dinner")]
    assert await run_at(env, 134) == []
    assert await run_at(env, 135) == [("agenda.item.ended", "Dinner")]


async def test_a_cancelled_running_item_never_ends(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        assert (await run_at(env, 60))[-1] == ("agenda.item.started", "Dinner")
        await c.post(f"/api/agenda/items/{item['id']}/cancel", json={"revision": 1}, headers=h)
        removed = await add(c, h, title="Show", starts_at=at(100))
        await c.delete(f"/api/agenda/items/{removed['id']}?revision=1", headers=h)
    assert await run_at(env, 200) == []
    assert await registered(env) == []


async def test_after_an_outage_starts_and_ends_fire_but_old_reminders_do_not(env: Env) -> None:
    async with env.client() as c:
        await add(c, env.writer(), ends_at=at(120))
    assert await run_at(env, 90) == [("agenda.item.started", "Dinner")]


async def test_an_edit_just_after_the_start_keeps_the_pending_start(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120), reminder_leads_minutes=[])
        env.clock[0] = NOW + timedelta(minutes=60, seconds=2)  # due, but no tick yet
        await c.patch(
            f"/api/agenda/items/{item['id']}",
            json={"revision": 1, "description": "Pizza"},
            headers=h,
        )
    assert await run_at(env, 61) == [("agenda.item.started", "Dinner")]


async def test_a_kind_change_reschedules_its_items(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        await add(c, h, kind="doors", starts_at=at(60))
        await c.put(
            "/api/agenda/kinds/doors",
            json={"name": "Doors", "revision": 1, "reminder_leads_minutes": [15]},
            headers=h,
        )
    assert await run_at(env, 45) == [("agenda.reminder.triggered", 15)]


async def test_a_lead_setting_change_reschedules_the_event(env: Env) -> None:
    async with env.client() as c:
        await add(c, env.writer(), starts_at=at(60))
    env.settings.values["ev-a"] = {"reminder_leads_minutes": [5]}
    unrelated = Event("e1", "admin.settings.changed", 1, "t", "admin", {"module": "agenda"})
    changed = Event(
        "e2",
        "admin.settings.changed",
        1,
        "t",
        "admin",
        {"module": "agenda", "keys": ["reminder_leads_minutes"], "settings_version": 1},
        tenant="ev-a",
    )
    with tenant_scope("ev-a"):
        await timers.on_settings_changed(env.app.state.deps, unrelated)
        await timers.on_settings_changed(env.app.state.deps, changed)
    assert await run_at(env, 50) == []
    assert await run_at(env, 55) == [("agenda.reminder.triggered", 5)]


async def test_admin_down_holds_the_timers_until_it_is_back(env: Env) -> None:
    async with env.client() as c:
        await add(c, env.writer(), starts_at=at(60), reminder_leads_minutes=[])
    env.settings.down = True
    assert await run_at(env, 60) == []
    env.settings.down = False
    assert await run_at(env, 61) == [("agenda.item.started", "Dinner")]


async def test_two_containers_never_fire_one_timer_twice(env: Env) -> None:
    async with env.client() as c:
        for n in range(5):
            await add(c, env.writer(), title=f"T{n}", starts_at=at(60), reminder_leads_minutes=[])
    env.clock[0] = NOW + timedelta(minutes=60)
    env.store.calls.clear()
    d = env.app.state.deps
    await asyncio.gather(timers.tick(d, batch=2), timers.tick(d, batch=2), timers.tick(d))
    await timers.tick(d)
    assert sorted(title for _, title in fired(env)) == [f"T{n}" for n in range(5)]


async def test_each_event_fires_only_its_own_timers(env: Env) -> None:
    h = env.writer()
    async with env.client("a.example.test") as a, env.client("b.example.test") as b:
        await add(a, h, title="A", starts_at=at(60), reminder_leads_minutes=[])
        await add(b, h, title="B", starts_at=at(90), reminder_leads_minutes=[])
    env.clock[0] = NOW + timedelta(minutes=90)
    await timers.tick(env.app.state.deps)
    started = [(e["tenant"], e["data"]["item"]["title"]) for e in env.events()[-2:]]
    assert started == [("ev-a", "A"), ("ev-b", "B")]


async def test_a_start_or_end_moved_to_now_or_before_still_fires(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        early = await add(c, h, title="Early", starts_at=at(70), reminder_leads_minutes=[])
        running = await add(c, h, title="Short", starts_at=at(-30), ends_at=at(30))
        env.clock[0] = NOW + timedelta(minutes=5)
        moved = await c.patch(
            f"/api/agenda/items/{early['id']}",
            json={"revision": 1, "starts_at": at(4)},  # it began early
            headers=h,
        )
        assert moved.status_code == 200, moved.text
        cut = await c.post(
            f"/api/agenda/items/{running['id']}/delay",
            json={"revision": 1, "minutes": -27},  # its end moves to 3, before now
            headers=h,
        )
        assert cut.status_code == 200, cut.text
    assert await run_at(env, 5) == [
        ("agenda.item.ended", "Short"),
        ("agenda.item.started", "Early"),
    ]
    assert await run_at(env, 100) == []  # once
