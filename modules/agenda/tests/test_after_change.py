"""After a change and around the event (#482): every change returns to its item in the list, today
has no line of its own outside the event, Bring back promises nothing it does not do, and a running
item delayed again is posted as running late."""

from __future__ import annotations

from datetime import timedelta

import conftest
import httpx
import pytest
from conftest import NOW, Env, at
from test_items import add
from test_merge import form_of
from test_quickadd import items, templates_of


def _target(response: httpx.Response) -> str:
    assert response.status_code == 303, response.text
    location = response.headers["location"]
    assert location.startswith("/agenda/?day=")
    return location.partition("#")[2]


async def test_every_change_returns_to_its_item_in_the_list(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        food = (await templates_of(c, h))["Food"]
        quick = await c.post(
            "/add", data={"title": "Pizza", "what": food, "when": "in30"}, headers=h
        )
        form = {**form_of(), "title": "Quiz", "kind": "activity", "starts": "2026-11-20T20:00"}
        form.pop("revision")
        full = await c.post("/items/new", data={**form, "ends": "2026-11-20T21:00"}, headers=h)
        pizza, quiz = await items(c, h)
        edit = form_of(title="Big quiz", starts="2026-11-20T20:00", ends="2026-11-20T21:00")
        saved = await c.post(f"/items/{quiz['id']}/edit", data=edit, headers=h)
        delay = {"revision": "2", "minutes": "15", "agenda_version": "3"}
        delayed = await c.post(f"/items/{quiz['id']}/delay", data=delay, headers=h)
        shown = await c.post(f"/items/{quiz['id']}/show-now", data={"revision": "3"}, headers=h)
        undone = await c.post(
            f"/undo/{shown.headers['location'].split('undo=')[1].split('#')[0]}", headers=h
        )
        cancelled = await c.post(f"/items/{pizza['id']}/cancel", data={"revision": "1"}, headers=h)
        back = await c.post(f"/items/{pizza['id']}/bring-back", headers=h)
        (again,) = [i for i in await items(c, h) if i["title"] == "Pizza"]
    assert _target(quick) == f"r-{pizza['id']}" and _target(full) == f"r-{quiz['id']}"
    assert _target(saved) == f"r-{quiz['id']}" and _target(delayed) == f"r-{quiz['id']}"
    assert _target(shown) == f"r-{quiz['id']}" and _target(undone) == f"r-{quiz['id']}"
    assert _target(cancelled) == f"r-{pizza['id']}"
    # Bring back adds the item again with a new id: the list returns to that one.
    assert _target(back) == f"r-{again['id']}" and again["id"] != pizza["id"]
    # The undo id stays a query value of its own, ahead of the target.
    assert "&undo=un_" in quick.headers["location"].partition("#")[0]


async def test_undoing_an_add_returns_to_the_day(env: Env) -> None:
    """The added item is gone, so there is no row to return to."""
    h = env.writer()
    async with env.client() as c:
        food = (await templates_of(c, h))["Food"]
        quick = await c.post(
            "/add", data={"title": "Pizza", "what": food, "when": "in30"}, headers=h
        )
        token = quick.headers["location"].split("undo=")[1].split("#")[0]
        undone = await c.post(f"/undo/{token}", headers=h)
    assert _target(undone) == ""


def _days(text: str) -> list[str]:
    return [part.split('"')[0] for part in text.split('class="canccu-agenda-dayline" id="day-')[1:]]


@pytest.mark.parametrize(
    ("starts", "ends"),
    [
        (NOW + timedelta(days=3), NOW + timedelta(days=4)),  # before the event
        (NOW - timedelta(days=4), NOW - timedelta(days=3)),  # after it
    ],
)
async def test_no_today_line_outside_the_event(
    env: Env, monkeypatch: pytest.MonkeyPatch, starts: object, ends: object
) -> None:
    monkeypatch.setitem(conftest.EVENT, "starts_at", str(starts).replace("+00:00", "Z"))
    monkeypatch.setitem(conftest.EVENT, "ends_at", str(ends).replace("+00:00", "Z"))
    h = env.writer()
    async with env.client() as c:
        await add(c, h, title="Doors", starts_at=at(3 * 1440 + 60))
        text = (await c.get("/", headers=h)).text
    assert _days(text) == ["2026-11-23"]
    assert 'id="now"' not in text and "Add item on Friday" not in text
    # Jump to now has nowhere to go.
    assert 'href="#now"' not in text


async def test_today_keeps_its_line_during_the_event(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        await add(c, h, title="Doors", starts_at=at(3 * 1440 + 60))
        text = (await c.get("/", headers=h)).text
    assert _days(text) == ["2026-11-20", "2026-11-23"]
    assert 'id="now"' in text and 'href="#now"' in text


async def test_bring_back_promises_no_message(env: Env) -> None:
    """Bring back adds the item again, and no one announces an added item (#482)."""
    h = env.writer()
    async with env.client() as c:
        quiz = await add(c, h, title="Quiz", starts_at=at(60), ends_at=at(120))
        await c.post(f"/api/agenda/items/{quiz['id']}/cancel", json={"revision": 1}, headers=h)
        page = (await c.get(f"/items/{quiz['id']}", headers=h)).text
    assert ">Bring back</button>" in page and "Until the event ends." in page
    assert "told" not in page.split(">Bring back</button>")[1].split("</form>")[0]


async def test_a_running_item_delayed_again_is_posted_as_running_late(env: Env) -> None:
    h = env.writer("screen.devices.read")
    async with env.client() as c:
        dinner = await add(c, h, title="Dinner", starts_at=at(30), ends_at=at(90))
        delay = {"revision": 1, "minutes": 10}
        await c.post(f"/api/agenda/items/{dinner['id']}/delay", json=delay, headers=h)
        env.clock[0] = NOW + timedelta(minutes=50)  # it started at 17:40
        again = {"revision": 2, "minutes": 5}
        await c.post(f"/api/agenda/items/{dinner['id']}/delay", json=again, headers=h)
        text = (await c.get("/", headers=h)).text
    post = text.split('class="canccu-agenda-post">')[1].split("</p>")[0]
    assert "Dinner runs 15 min late, until 18:45" in post
