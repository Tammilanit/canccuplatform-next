"""Show on screens now, with the optional announcement in the same step (plan issue-187 D14,
contracts/agenda.md, Announce)."""

from __future__ import annotations

from conftest import Env, at
from test_items import add


async def test_show_now_offers_the_announcement_and_says_who_hears_it(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        quiz = await add(c, h, title="Quiz", starts_at=at(45), ends_at=at(105))
        crew = await add(c, h, title="Briefing", visibility="crew", starts_at=at(45), notify=[])
        page = await c.get(f"/items/{quiz['id']}/show-now", headers=h)
        quiet = await c.get(f"/items/{crew['id']}/show-now", headers=h)
    text = page.text
    assert "Announce it too" in text and 'name=message value="" maxlength="140"' in text
    announce = text.split("If you announce it")[1]
    assert "Phones: a notice (everyone), to those who follow the schedule" in announce
    assert "Discord: a post in the event&#x27;s channel." in announce
    assert "Phones: nothing; the item&#x27;s channels leave phones out." in quiet.text
    assert "Discord" not in quiet.text.split("If you announce it")[1]


async def test_show_now_brings_forward_first_then_announces_with_the_new_times(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        quiz = await add(c, h, title="Quiz", starts_at=at(45), ends_at=at(105))
        env.store.calls.clear()
        done = await c.post(
            f"/items/{quiz['id']}/show-now",
            data={"revision": "1", "announce": "1", "message": "Quiz starts now, main stage"},
            headers=h,
        )
    delayed, announced = env.events()
    assert delayed["type"] == "agenda.item.delayed"
    assert announced["type"] == "agenda.item.announced"
    assert announced["data"]["item"]["starts_at"] == at(0)
    assert announced["data"]["message"] == "Quiz starts now, main stage"
    assert done.status_code == 303 and "done=shown_announced" in done.headers["location"]


async def test_a_running_item_can_still_be_announced(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        dinner = await add(c, h, starts_at=at(-5), ends_at=at(60))
        item_page = await c.get(f"/items/{dinner['id']}", headers=h)
        page = await c.get(f"/items/{dinner['id']}/show-now", headers=h)
        env.store.calls.clear()
        done = await c.post(
            f"/items/{dinner['id']}/show-now",
            data={"revision": "1", "announce": "1", "message": ""},
            headers=h,
        )
        landed = await c.get(done.headers["location"].removeprefix("/agenda"), headers=h)
    assert "/show-now" in item_page.text
    assert "Screens already show it" in page.text and "Announce it too" in page.text
    (announced,) = env.events()
    assert announced["type"] == "agenda.item.announced" and announced["data"]["message"] is None
    assert "Announced." in landed.text


async def test_a_refused_announcement_brings_nothing_forward(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        quiet = await add(c, h, kind="quiet_hours", starts_at=at(30), ends_at=at(600))
        quiz = await add(c, h, title="Quiz", starts_at=at(45), ends_at=at(105))
        page = await c.get(f"/items/{quiet['id']}/show-now", headers=h)
        env.store.calls.clear()
        refused = await c.post(
            f"/items/{quiet['id']}/show-now", data={"revision": "1", "announce": "1"}, headers=h
        )
        too_long = await c.post(
            f"/items/{quiz['id']}/show-now",
            data={"revision": "1", "announce": "1", "message": "x" * 141},
            headers=h,
        )
    assert "Announce it too" not in page.text
    assert refused.status_code == 400 and too_long.status_code == 400
    assert env.store.calls == []
