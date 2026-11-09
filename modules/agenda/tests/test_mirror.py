"""The tournament-session mirror (contracts/agenda.md, Tournament sessions), fed fixtures whose
shape test_fixtures.py checks against the event catalog."""

from __future__ import annotations

import copy
import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from canccu_kit import Event, tenant_scope
from conftest import NOW, Env, at
from test_timers import run_at

from canccu_agenda import mirror

FIXTURES = Path(__file__).parent / "fixtures" / "tournament"


def fixture(name: str) -> dict[str, Any]:
    value: dict[str, Any] = json.loads((FIXTURES / f"session.{name}.json").read_text())
    return value


def session(name: str = "added", **fields: Any) -> dict[str, Any]:
    raw: dict[str, Any] = copy.deepcopy(fixture(name)["data"]["session"])
    raw.update(fields)
    return raw


async def feed(env: Env, name: str, tenant: str = "ev-a", **data: Any) -> None:
    raw = fixture(name)
    raw["data"].update(data)
    event = Event(raw["id"], raw["type"], 1, raw["time"], "tournament", raw["data"], tenant=tenant)
    with tenant_scope(tenant):
        await mirror.handle(env.app.state.deps, event)


async def items(env: Env) -> list[dict[str, Any]]:
    async with env.client() as c:
        response = await c.get("/api/agenda/items", headers=env.writer())
        body: list[dict[str, Any]] = response.json()["items"]
    return body


def types(env: Env) -> list[str]:
    return [e["type"] for e in env.events()]


async def test_an_added_session_becomes_a_managed_tournament_item(env: Env) -> None:
    await feed(env, "added", session=session(is_final=True))
    (item,) = await items(env)
    assert item["title"] == "Demo Game final" and item["kind"] == "tournament"
    assert item["starts_at"] == item["planned_starts_at"] == at(120)
    assert item["ends_at"] == at(240) and item["visibility"] == "public"
    assert item["links"] == {"tournament_id": "tn_1", "tournament_session_id": "ts_1"}
    assert item["managed_by"] == "tournament"
    assert item["reminder_leads_minutes"] is None and item["notify"] is None
    (event,) = env.events()
    assert event["type"] == "agenda.item.added"
    assert event["data"] == {"item": item, "agenda_version": 1, "actor_user_id": "u_org"}
    assert await run_at(env, 90) == [("agenda.reminder.triggered", 30)]  # reminders as any item


async def test_without_the_tournament_kind_the_item_is_other(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        await c.get("/api/agenda/kinds")
        await c.delete("/api/agenda/kinds/tournament?revision=1", headers=h)
    await feed(env, "added")
    assert [i["kind"] for i in await items(env)] == ["other"]


async def test_a_changed_session_moves_its_item_and_equal_times_change_nothing(env: Env) -> None:
    await feed(env, "added")
    await feed(env, "changed")
    (moved,) = await items(env)
    assert moved["starts_at"] == moved["planned_starts_at"] == at(150)
    assert moved["ends_at"] == at(240) and moved["revision"] == 2
    changed = env.events()[-1]
    assert changed["type"] == "agenda.item.changed"
    assert changed["data"]["changed"] == ["starts_at"]
    await feed(env, "changed", session=session("changed", revision=3, status="running"))
    assert types(env) == ["agenda.item.added", "agenda.item.changed"]


async def test_a_session_that_follows_the_agendas_delay_keeps_the_delay(env: Env) -> None:
    h = env.writer()
    await feed(env, "added")
    (item,) = await items(env)
    async with env.client() as c:
        response = await c.post(
            f"/api/agenda/items/{item['id']}/delay",
            json={"revision": 1, "minutes": 15},
            headers=h,
        )
        assert response.status_code == 200, response.text
    followed = session(starts_at=at(135), ends_at=at(255), revision=2)
    await feed(env, "changed", session=followed)
    (kept,) = await items(env)
    assert kept["delay_minutes"] == 15 and kept["planned_starts_at"] == at(120)
    assert types(env)[-1] == "agenda.item.delayed"


async def test_the_organiser_keeps_their_own_fields(env: Env) -> None:
    h = env.writer()
    await feed(env, "added")
    (item,) = await items(env)
    async with env.client() as c:
        await c.patch(
            f"/api/agenda/items/{item['id']}",
            json={"revision": 1, "location": "Main stage", "visibility": "attendees"},
            headers=h,
        )
    await feed(
        env, "changed", session=session(game={"id": "g_1", "name": "Other Game"}, revision=2)
    )
    (renamed,) = await items(env)
    assert renamed["title"] == "Other Game" and renamed["location"] == "Main stage"
    assert renamed["visibility"] == "attendees"


async def test_a_late_or_redelivered_event_changes_nothing(env: Env) -> None:
    await feed(env, "added")
    await feed(env, "changed")
    await feed(env, "added")  # revision 1 again, after 2
    await feed(env, "changed")
    assert types(env) == ["agenda.item.added", "agenda.item.changed"]
    assert (await items(env))[0]["starts_at"] == at(150)


async def test_a_cancelled_session_cancels_its_item_even_while_it_runs(env: Env) -> None:
    await feed(env, "added")
    assert (await run_at(env, 120))[-1] == ("agenda.item.started", "Demo Game")
    await feed(env, "cancelled")
    (item,) = await items(env)
    assert item["status"] == "cancelled"
    event = env.events()[-1]
    assert event["type"] == "agenda.item.cancelled" and event["data"]["item"] == item
    assert await run_at(env, 300) == []  # its end is dropped: the cancel is its end


async def test_a_session_that_ended_early_ends_its_item_instead(env: Env) -> None:
    await feed(env, "added")
    raw = fixture("cancelled")
    raw["time"] = at(200)
    with tenant_scope("ev-a"):
        await mirror.handle(
            env.app.state.deps,
            Event(
                raw["id"],
                raw["type"],
                1,
                raw["time"],
                "tournament",
                {**raw["data"], "session": session(status="finished", revision=3)},
                tenant="ev-a",
            ),
        )
    (item,) = await items(env)
    assert item["status"] == "scheduled"
    assert item["ends_at"] == item["planned_ends_at"] == at(200)
    assert env.events()[-1]["data"]["changed"] == ["ends_at"]


async def test_a_reopened_session_gets_a_new_item(env: Env) -> None:
    await feed(env, "added")
    await feed(env, "cancelled")
    (old,) = await items(env)
    await feed(env, "changed", session=session(status="registration_open", revision=4))
    (new,) = await items(env)
    assert new["id"] != old["id"] and new["status"] == "scheduled"
    assert types(env)[-2:] == ["agenda.item.removed", "agenda.item.added"]
    assert env.events()[-2]["data"]["item_id"] == old["id"]


async def test_a_removed_session_leaves_a_tombstone(env: Env) -> None:
    await feed(env, "added")
    (item,) = await items(env)
    await feed(env, "removed")
    assert await items(env) == []
    removed = env.events()[-1]
    assert removed["type"] == "agenda.item.removed"
    assert removed["data"] == {
        "item_id": item["id"],
        "visibility": "public",
        "agenda_version": 2,
        "actor_user_id": "u_org",
    }
    await feed(env, "added", session=session(revision=9))
    await feed(env, "changed", session=session("changed", revision=10))
    assert await items(env) == [] and len(env.events()) == 2
    await feed(env, "removed")  # again: nothing to remove
    assert len(env.events()) == 2


async def test_the_organiser_cannot_change_what_the_session_owns(env: Env) -> None:
    h = env.writer()
    await feed(env, "added")
    (item,) = await items(env)
    async with env.client() as c:
        url = f"/api/agenda/items/{item['id']}"
        patch = await c.patch(url, json={"revision": 1, "starts_at": at(0)}, headers=h)
        cancel = await c.post(f"{url}/cancel", json={"revision": 1}, headers=h)
        remove = await c.delete(f"{url}?revision=1", headers=h)
    codes = [r.json()["error"]["code"] for r in (patch, cancel, remove)]
    assert codes == ["item_managed"] * 3


async def test_a_broken_session_is_skipped(env: Env) -> None:
    await feed(env, "added", session={"id": "ts_1"})
    await feed(env, "added", session=session(ends_at=at(100)))  # ends before it starts
    await feed(env, "removed", session_id=None)
    assert await items(env) == [] and env.events() == []


async def test_sessions_stay_in_their_event(env: Env) -> None:
    await feed(env, "added", tenant="ev-b")
    assert await items(env) == []
    async with env.client("b.example.test") as b:
        assert len((await b.get("/api/agenda/items")).json()["items"]) == 1


async def test_admin_down_is_retried_before_the_event_is_given_up(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    pauses: list[float] = []

    async def sleep(seconds: float) -> None:
        pauses.append(seconds)
        if len(pauses) == 2:
            env.settings.down = False

    monkeypatch.setattr(mirror, "wait", sleep)
    env.settings.down = True
    await feed(env, "added")
    assert pauses == [1.0, 2.0] and len(await items(env)) == 1


def test_the_fixtures_session_starts_two_hours_after_now() -> None:
    # The tests above read the fixture's times as at(120) and at(240).
    assert NOW + timedelta(minutes=120) == NOW.replace(hour=19)


async def test_an_item_ended_early_emits_ended_on_the_next_tick(env: Env) -> None:
    await feed(env, "added")
    assert (await run_at(env, 120))[-1] == ("agenda.item.started", "Demo Game")
    raw = fixture("cancelled")
    env.clock[0] = NOW + timedelta(minutes=181)
    with tenant_scope("ev-a"):
        await mirror.handle(
            env.app.state.deps,
            Event(
                raw["id"],
                raw["type"],
                1,
                at(180),
                "tournament",
                {**raw["data"], "session": session(status="finished", revision=3)},
                tenant="ev-a",
            ),
        )
    assert await run_at(env, 181) == [("agenda.item.ended", "Demo Game")]
    assert await run_at(env, 300) == []  # not again at the planned end


async def test_a_remove_needs_no_admin(env: Env) -> None:
    await feed(env, "added")
    env.settings.down = True
    await feed(env, "removed")
    assert await items(env) == []
