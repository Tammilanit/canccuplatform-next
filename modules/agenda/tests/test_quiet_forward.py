"""#554: "Show on screens now" brings an item forward quietly, the delay confirm shows a running
following item's new end, and an event ending at midnight has no extra day."""

from __future__ import annotations

from typing import Any

import pytest
from conftest import EVENT, Env, at
from test_edit_pages import variant
from test_items import add


def pushes(events: list[dict[str, Any]]) -> list[str]:
    """The events Notify turns into a push (contracts/notify.md, the `schedule` triggers): an
    announced delay and an announcement."""
    told = [e for e in events if e["type"] == "agenda.item.delayed" and e["data"]["announce"]]
    return [e["type"] for e in told + [e for e in events if e["type"] == "agenda.item.announced"]]


async def test_show_now_without_announcing_sends_no_push(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        quiz = await add(c, h, title="Quiz", starts_at=at(45), ends_at=at(105))
        env.store.calls.clear()
        done = await c.post(f"/items/{quiz['id']}/show-now", data={"revision": "1"}, headers=h)
    assert done.status_code == 303 and "done=shown" in done.headers["location"]
    [delayed] = env.events()
    assert delayed["type"] == "agenda.item.delayed" and delayed["data"]["item"]["starts_at"] == at(
        0
    )
    assert pushes(env.events()) == []


async def test_show_now_with_announcing_sends_one_push(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        quiz = await add(c, h, title="Quiz", starts_at=at(45), ends_at=at(105))
        env.store.calls.clear()
        form = {"revision": "1", "announce": "1", "message": "Quiz now"}
        await c.post(f"/items/{quiz['id']}/show-now", data=form, headers=h)
    assert pushes(env.events()) == ["agenda.item.announced"]


async def test_the_show_now_page_says_bringing_forward_tells_no_one(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        quiz = await add(c, h, title="Quiz", starts_at=at(45), ends_at=at(105))
        page = (await c.get(f"/items/{quiz['id']}/show-now", headers=h)).text
    moved = page.split("If you announce it")[0]
    assert "<dt>Phones</dt><dd>No push" in moved


async def test_a_running_following_item_shows_its_new_end(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        dinner = await add(c, h, title="Dinner", starts_at=at(-30), ends_at=at(60))
        await add(c, h, title="Quiz", starts_at=at(-10), ends_at=at(30))
        page = await c.get(f"/items/{dinner['id']}/delay?minutes=15&chosen=1", headers=h)
    both = variant(page.text, 1, 1)
    assert "Quiz ends 17:45 instead of 17:30" in both
    assert "<s>16:50</s>" not in both


async def test_an_event_ending_at_midnight_has_no_extra_day(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(EVENT, "starts_at", "2026-11-19T09:00:00Z")
    monkeypatch.setitem(EVENT, "ends_at", "2026-11-21T00:00:00Z")
    async with env.client() as c:
        form = (await c.get("/add", headers=env.writer())).text
    # Its days are Thu 19 and Fri 20, one on each side: Wed 18 to Sat 21, never Sun 22.
    assert ">Wed 18 Nov<" in form and ">Sat 21 Nov<" in form
    assert "Sun 22 Nov" not in form
