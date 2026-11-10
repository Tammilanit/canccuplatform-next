"""Delay, cancel and "show on screens now" from the pages: the preview first, then the change."""

from __future__ import annotations

from datetime import timedelta

import pytest
from canccu_kit import KitError, tenant_scope
from conftest import NOW, Env, at
from test_items import add

from canccu_agenda import edits


async def test_delay_previews_what_moves_what_stays_and_who_hears(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        dinner = await add(c, h, starts_at=at(-30), ends_at=at(60))
        semis = await add(c, h, title="Semis", kind="tournament", starts_at=at(90))
        quiet = await add(
            c, h, title="Quiet", kind="quiet_hours", starts_at=at(480), ends_at=at(900)
        )
        far = await add(c, h, title="Breakfast", starts_at=at(960))
        env.store.calls.clear()
        choose = await c.get(f"/items/{dinner['id']}/delay", headers=h)
        preview = await c.get(f"/items/{dinner['id']}/delay?minutes=15&following=1", headers=h)
        alone = await c.get(f"/items/{dinner['id']}/delay?minutes=15", headers=h)
    assert "and everything after it" in choose.text and " checked>" in choose.text
    assert "This will change" not in choose.text
    text = preview.text
    assert "Dinner is running: its end moves, its start stays." in text
    assert "Dinner ends 18:15 instead of 18:00" in text
    assert "Semis 18:30 → 18:45" in text and "Breakfast 09:00 → 09:15" in text
    assert "Quiet stays at 01:00: quiet hours never move with a delay." in text
    assert "Phones: one notice per audience (everyone)" in text
    assert "Phones stay quiet for 1 item(s) starting more than 2 h from now." in text
    assert "Delay 3 items +15 min" in text
    assert "Semis" not in alone.text.split("This will change")[1]
    assert env.store.calls == []  # a preview changes nothing
    del quiet, far, semis


async def test_confirming_a_delay_applies_it_unless_the_agenda_changed(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        dinner = await add(c, h, ends_at=at(120))
        show = await add(c, h, title="Show", starts_at=at(180))
        form = {"revision": "1", "minutes": "15", "following": "1", "agenda_version": "2"}
        await add(c, h, title="Late addition", starts_at=at(240))
        stale = await c.post(f"/items/{dinner['id']}/delay", data=form, headers=h)
        done = await c.post(
            f"/items/{dinner['id']}/delay", data={**form, "agenda_version": "3"}, headers=h
        )
        items = (await c.get("/api/agenda/items", headers=h)).json()["items"]
        again = await c.get(stale.headers["location"].removeprefix("/agenda"), headers=h)
    assert stale.status_code == 303 and "changed=1" in stale.headers["location"]
    assert "The run of show changed meanwhile" in again.text
    assert done.status_code == 303
    assert done.headers["location"].startswith("/agenda/?day=2026-11-20&done=delayed&undo=un_")
    assert [i["delay_minutes"] for i in items] == [15, 15, 15]
    delayed = [e for e in env.events() if e["type"] == "agenda.item.delayed"]
    assert len(delayed) == 3 and {e["data"]["item"]["id"] for e in delayed} >= {show["id"]}


async def test_a_refused_delay_says_why_on_the_page(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, starts_at=at(-30), ends_at=at(60))
        response = await c.get(f"/items/{item['id']}/delay?other=-90", headers=h)
    assert "the shift would end" in response.text and "This will change" not in response.text


async def test_cancel_previews_then_cancels(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, title="Crew lunch", visibility="crew", starts_at=at(30))
        preview = await c.get(f"/items/{item['id']}/cancel", headers=h)
        done = await c.post(f"/items/{item['id']}/cancel", data={"revision": "1"}, headers=h)
        again = await c.get(f"/items/{item['id']}/cancel", headers=h)
        cancelled = (await c.get(f"/api/agenda/items/{item['id']}", headers=h)).json()
    assert "Crew lunch at 17:30 is cancelled" in preview.text
    assert "Screens: nothing; crew items never show on a screen." in preview.text
    assert "Phones: a notice (crew only)" in preview.text
    assert done.status_code == 303 and cancelled["status"] == "cancelled"
    assert again.status_code == 409 and "already cancelled" in again.text


async def test_show_now_brings_an_item_forward_so_screens_show_it(env: Env) -> None:
    h = env.writer()
    env.clock[0] = NOW + timedelta(seconds=30)
    async with env.client() as c:
        quiz = await add(c, h, title="Quiz", starts_at=at(45), ends_at=at(105))
        doors = await add(c, h, title="Doors", kind="doors", starts_at=at(45))
        preview = await c.get(f"/items/{quiz['id']}/show-now", headers=h)
        await c.post(f"/items/{quiz['id']}/show-now", data={"revision": "1"}, headers=h)
        await c.post(f"/items/{doors['id']}/show-now", data={"revision": "1"}, headers=h)
        now = (await c.get("/api/agenda/now", headers=h)).json()
    assert "Quiz 17:45 → 17:00" in preview.text
    # With an end it runs now; a moment becomes the next thing, within the minute.
    assert [i["id"] for i in now["current"]] == [quiz["id"]]
    assert now["current"][0]["delay_minutes"] == -45
    assert [i["id"] for i in now["next"]] == [doors["id"]]
    assert now["next"][0]["starts_at"] == at(1)


async def test_show_now_refuses_what_it_cannot_bring_forward(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        running = await add(c, h, starts_at=at(-5), ends_at=at(60))
        far = await add(c, h, title="Tomorrow", starts_at=at(60 * 13))
        shown = await c.get(f"/items/{running['id']}/show-now", headers=h)
        refused = await c.get(f"/items/{far['id']}/show-now", headers=h)
    assert "Screens already show it" in shown.text
    assert refused.status_code == 400 and "more than 12 hours" in refused.text


async def test_enter_in_other_previews_the_typed_minutes_not_a_chip(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        form = (await c.get(f"/items/{item['id']}/delay", headers=h)).text
        typed = await c.get(f"/items/{item['id']}/delay?other=-20&following=1", headers=h)
        chip = await c.get(f"/items/{item['id']}/delay?minutes=15&other=-20", headers=h)
    # The form's first button, the one Enter uses, sends no chip.
    first = form.split('class="canccu-agenda-form">')[1].split("</button>")[0]
    assert "name=" not in first
    assert "Bring 1 item forward 20 min" in typed.text
    assert "Delay 1 item +15 min" in chip.text  # a tapped chip wins


async def test_the_delay_refuses_a_change_of_the_agenda_under_its_lock(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
    session = env.rights.sessions["u_org"]
    d = env.app.state.deps
    with tenant_scope("ev-a"):
        with pytest.raises(KitError) as refused:
            await edits.delay(d, session, item["id"], 1, 15, True, expected_version=0)
        _, moved = await edits.delay(d, session, item["id"], 1, 15, True, expected_version=1)
    assert refused.value.code == "agenda_changed"
    assert moved[0]["delay_minutes"] == 15


async def test_show_now_keeps_the_delay_limit_at_the_confirm(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        far = await add(c, h, title="Tomorrow", starts_at=at(60 * 13))
        response = await c.post(f"/items/{far['id']}/show-now", data={"revision": "1"}, headers=h)
        unchanged = (await c.get(f"/api/agenda/items/{far['id']}", headers=h)).json()
    assert response.status_code == 400 and "more than 12 hours" in response.text
    assert unchanged["revision"] == 1
