"""Quiet changes (#388): a delay or an edit with `announce: false` (contracts/agenda.md,
Notification channels and Reminders), and the pages' "Tell people" choice."""

from __future__ import annotations

import json
import re
from datetime import timedelta
from pathlib import Path
from typing import Any

from conftest import NOW, Env, at
from test_items import add
from test_timers import run_at
from test_undo import undo_id

NOTIFY = Path(__file__).resolve().parents[3] / "contracts" / "notify.md"


def of(env: Env, event_type: str) -> list[dict[str, Any]]:
    return [e for e in env.events() if e["type"] == event_type]


async def test_delay_and_edit_carry_announce_true_by_default_and_false_when_quiet(
    env: Env,
) -> None:
    h = env.writer()
    async with env.client() as c:
        dinner = await add(c, h, ends_at=at(120))
        await add(c, h, title="Show", starts_at=at(180))
        path = f"/api/agenda/items/{dinner['id']}"
        await c.post(f"{path}/delay", json={"revision": 1, "minutes": 5}, headers=h)
        quiet = {"revision": 2, "minutes": 5, "following": True, "announce": False}
        await c.post(f"{path}/delay", json=quiet, headers=h)
        await c.patch(path, json={"revision": 3, "title": "Supper"}, headers=h)
        await c.patch(path, json={"revision": 4, "title": "Tea", "announce": False}, headers=h)
        bad = await c.patch(path, json={"revision": 5, "title": "X", "announce": "no"}, headers=h)
        bad_delay = await c.post(
            f"{path}/delay", json={"revision": 5, "minutes": 5, "announce": 0}, headers=h
        )
    # Every event of one shift carries the same choice.
    assert [e["data"]["announce"] for e in of(env, "agenda.item.delayed")] == [True, False, False]
    assert [e["data"]["announce"] for e in of(env, "agenda.item.changed")] == [True, False]
    assert bad.status_code == bad_delay.status_code == 400
    assert bad.json()["error"]["code"] == "invalid_request"


def _schedule_delay_trigger() -> dict[str, Any]:
    """The `schedule` registration's delay trigger, as contracts/notify.md writes it."""
    text = NOTIFY.read_text()
    block = re.search(r"The `schedule` registration in full.*?```json\n(.*?)```", text, re.S)
    assert block is not None
    triggers = json.loads(block.group(1))["triggers"]
    trigger: dict[str, Any] = next(t for t in triggers if t["event"] == "agenda.item.delayed")
    return trigger


def _field(event: dict[str, Any], path: str) -> Any:
    value: Any = event
    for part in path.split("."):
        value = value.get(part) if isinstance(value, dict) else None
    return value


async def test_notify_announces_the_agendas_delay_only_when_it_says_announce(env: Env) -> None:
    """The agenda's own events against Notify's condition on `data.announce` (the engine's side,
    the same registration, is modules/notify/tests/test_engine.py)."""
    (condition,) = [w for w in _schedule_delay_trigger()["where"] if w["field"] == "data.announce"]
    assert condition == {"field": "data.announce", "op": "eq", "value": True}
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        path = f"/api/agenda/items/{item['id']}/delay"
        await c.post(path, json={"revision": 1, "minutes": 10}, headers=h)
        await c.post(path, json={"revision": 2, "minutes": 10, "announce": False}, headers=h)
    told, quiet = of(env, "agenda.item.delayed")
    assert _field(told, condition["field"]) is True
    assert _field(quiet, condition["field"]) is False


async def test_a_quiet_delay_never_fires_a_reminder_again(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        assert await run_at(env, 30) == [("agenda.reminder.triggered", 30)]
        env.clock[0] = NOW + timedelta(minutes=35)
        path = f"/api/agenda/items/{item['id']}/delay"
        await c.post(path, json={"revision": 1, "minutes": 15, "announce": False}, headers=h)
        # A second quiet change still knows the 30 has gone out.
        await c.post(path, json={"revision": 2, "minutes": 5, "announce": False}, headers=h)
    assert await run_at(env, 50) == []  # the 30 would have fired again here
    # The 10 had not gone out yet: it follows the item, as any pending reminder does.
    assert await run_at(env, 70) == [("agenda.reminder.triggered", 10)]
    assert await run_at(env, 80) == [("agenda.item.started", "Dinner")]


async def test_a_quiet_change_moves_a_reminder_an_announced_change_armed(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120), reminder_leads_minutes=[30])
        assert await run_at(env, 30) == [("agenda.reminder.triggered", 30)]
        env.clock[0] = NOW + timedelta(minutes=35)
        path = f"/api/agenda/items/{item['id']}"
        await c.post(f"{path}/delay", json={"revision": 1, "minutes": 15}, headers=h)
        # Armed again for 45 by the announced delay; the quiet move takes it along.
        moved = {"revision": 2, "starts_at": at(80), "ends_at": at(140), "announce": False}
        await c.patch(path, json=moved, headers=h)
    assert await run_at(env, 45) == []
    assert await run_at(env, 50) == [("agenda.reminder.triggered", 30)]


async def test_undoing_a_quiet_delay_is_quiet_too(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        dinner = await add(c, h, ends_at=at(120))
        form = {"revision": "1", "minutes": "15", "announce": "", "agenda_version": "1"}
        token = undo_id(await c.post(f"/items/{dinner['id']}/delay", data=form, headers=h))
        await c.post(f"/undo/{token}", headers=h)
    assert [e["data"]["announce"] for e in of(env, "agenda.item.delayed")] == [False, False]


async def test_the_delay_page_offers_a_quiet_delay(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        dinner = await add(c, h, ends_at=at(120))
        alone = await add(c, h, title="Last", starts_at=at(600))
        quiet = await c.get(f"/items/{dinner['id']}/delay?minutes=10", headers=h)
        last = await c.get(f"/items/{alone['id']}/delay", headers=h)
        form = {"revision": "1", "minutes": "10", "announce": "", "agenda_version": "2"}
        done = await c.post(f"/items/{dinner['id']}/delay", data=form, headers=h)
    text = quiet.text
    assert 'name="announce" value=1>' in text  # unticked stays unticked
    assert "People: nobody is told. No Discord post, no push" in text
    assert "with a notice" not in text and "Phones:" not in text
    assert "Delay 1 item +10 min quietly" in text
    assert 'name="announce" value=""' in text  # the confirm keeps the choice
    assert "Also move the 1 item after it" in quiet.text
    assert "items after it" not in last.text and "item after it" not in last.text
    assert done.status_code == 303
    ((event,),) = [of(env, "agenda.item.delayed")]
    assert event["data"]["announce"] is False and event["data"]["minutes"] == 10


async def test_the_edit_form_tells_people_unless_unticked(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        edit = await c.get(f"/items/{item['id']}/edit", headers=h)
        new = await c.get("/items/new", headers=h)
        fields = {
            "revision": "1",
            "title": "Dinner",
            "kind": "meal",
            "starts": "2026-11-20T19:00",
            "ends": "2026-11-20T20:00",
            "visibility": "public",
        }
        preview = await c.post(f"/items/{item['id']}/edit", data=fields, headers=h)
        await c.post(f"/items/{item['id']}/edit", data={**fields, "confirm": "1"}, headers=h)
        told = {**fields, "revision": "2", "title": "Supper", "announce": "1"}
        await c.post(f"/items/{item['id']}/edit", data=told, headers=h)
    assert 'name="announce" value=1 checked>' in edit.text
    assert "Tell people (Discord, phones)" in edit.text
    assert "Tell people" not in new.text  # an added item has nothing to announce yet
    assert "People: nobody is told" in preview.text and "Move it quietly" in preview.text
    assert [e["data"]["announce"] for e in of(env, "agenda.item.changed")] == [False, True]
