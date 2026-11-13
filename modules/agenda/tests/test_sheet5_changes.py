"""Quick add, delay and cancel as sheet 5 draws them (#434): the Day field and a time after
midnight, the Length chips and a button that repeats day and time, the overlap a delay of one item
makes, Bring back after a cancel, and dates in the event's format."""

from __future__ import annotations

import conftest
import pytest
from conftest import Env, at
from test_edit_pages import variant
from test_items import add
from test_quickadd import items, templates_of


async def test_quick_add_has_a_day_field_length_chips_and_a_button_that_says_when(
    env: Env,
) -> None:
    h = env.writer()
    async with env.client() as c:
        plain = (await c.get("/add", headers=h)).text
        gap = (await c.get("/add?day=2026-11-21&at=19:00&minutes=30", headers=h)).text
        script = await c.get("/static/quickadd.js")
    day = plain.split("<legend>Day</legend>")[1].split("</fieldset>")[0]
    assert 'name=day value="2026-11-20" checked><span>Fri 20 Nov</span>' in day
    assert 'name=day value="2026-11-21"><span>Sat 21 Nov</span>' in day
    length = plain.split("<legend>Length</legend>")[1].split("</fieldset>")[0]
    for value, label in (("15", "15 min"), ("30", "30 min"), ("60", "1 h"), ("other", "Other…")):
        assert f'name=length value="{value}"><span>{label}</span>' in length
    assert ">Add now</button>" in plain
    # A gap names its day and time: the button repeats them, and its length is a chip.
    assert 'name=day value="2026-11-21" checked>' in gap
    assert 'name=length value="30" checked>' in gap and ">Add on Sat at 19:00</button>" in gap
    assert '<script src="/agenda/static/quickadd.js" defer></script>' in plain
    assert script.status_code == 200 and "after midnight" in script.text


async def test_a_time_after_midnight_picks_the_next_day(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        food = (await templates_of(c, h))["Food"]
        form = {"what": food, "when": "at", "at": "00:30", "day": "2026-11-20"}
        # The day as the form offered it: after midnight is the next one.
        night = await c.post(
            "/add", data={**form, "title": "Snacks", "day_auto": "2026-11-20"}, headers=h
        )
        # A day the organiser picked stays.
        await c.post("/add", data={**form, "title": "Early"}, headers=h)
        early, snacks = await items(c, h)
        page = (await c.get(night.headers["location"].removeprefix("/agenda"), headers=h)).text
    assert snacks["title"] == "Snacks" and snacks["starts_at"] == at(60 * 7 + 30)
    assert early["title"] == "Early" and early["starts_at"] == at(-60 * 16 - 30)
    assert "Added to the next day: its time is after midnight." in page


async def test_quick_add_takes_the_length_chip(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        food = (await templates_of(c, h))["Food"]
        form = {"what": food, "when": "at", "day": "2026-11-20"}
        await c.post("/add", data={**form, "at": "19:00", "title": "A", "length": "15"}, headers=h)
        other = {"length": "other", "minutes": "45"}
        await c.post("/add", data={**form, "at": "20:00", "title": "B", **other}, headers=h)
        await c.post("/add", data={**form, "at": "21:00", "title": "C", "length": "60"}, headers=h)
        a, b, c_ = await items(c, h)
    assert a["ends_at"] == at(135) and b["ends_at"] == at(225) and c_["ends_at"] == at(300)


async def test_a_delay_of_one_item_warns_of_the_overlap_it_makes(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        show = await add(c, h, title="Show", starts_at=at(60), ends_at=at(120))
        await add(c, h, title="Board games", kind="other", starts_at=at(105), ends_at=at(165))
        query = {"delay": show["id"], "minutes": "10"}
        text = (await c.get("/", params=query, headers=h)).text
    sheet = text.split('<dialog open class="canccu-agenda-sheet"')[1].split("</dialog>")[0]
    alone = variant(sheet, 0, 1)
    assert (
        "<dt>The day</dt><dd>The item after it keeps its time."
        " Board games (18:45) now overlaps it by 25 min.</dd>"
    ) in alone
    assert "<dt>Also moves</dt><dd>Board games" in variant(sheet, 1, 1)


async def test_cancel_offers_bring_back_until_the_event_ends(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    h = env.writer()
    async with env.client() as c:
        quiz = await add(c, h, title="Quiz", starts_at=at(60), ends_at=at(120), location="Café")
        confirm = (await c.get(f"/items/{quiz['id']}/cancel", headers=h)).text
        await c.post(f"/items/{quiz['id']}/cancel", data={"revision": "1"}, headers=h)
        side = (await c.get(f"/?item={quiz['id']}", headers=h)).text
        item_page = (await c.get(f"/items/{quiz['id']}", headers=h)).text
        back = await c.post(f"/items/{quiz['id']}/bring-back", headers=h)
        (again,) = await items(c, h)
        types = [e["type"] for e in env.events()]
        cancelled = await add(c, h, title="Raffle", starts_at=at(200))
        await c.post(f"/api/agenda/items/{cancelled['id']}/cancel", json={"revision": 1}, headers=h)
        monkeypatch.setitem(conftest.EVENT, "ends_at", at(-1))
        over = (await c.get(f"/items/{cancelled['id']}", headers=h)).text
        refused = await c.post(f"/items/{cancelled['id']}/bring-back", headers=h)
    assert "<dt>Undo</dt><dd>Changes → Bring back, until the event ends.</dd>" in confirm
    assert "Cancelling is final" not in confirm and ">Keep the item</a>" in confirm
    action = f'action="/agenda/items/{quiz["id"]}/bring-back"'
    assert action in side.split("canccu-agenda-side")[1] and action in item_page
    assert ">Bring back</button>" in item_page
    assert back.status_code == 303 and "done=brought_back" in back.headers["location"]
    assert again["title"] == "Quiz" and again["status"] == "scheduled"
    assert again["starts_at"] == at(60) and again["location"] == "Café"
    assert types.count("agenda.item.added") == 2 and "agenda.item.removed" in types
    assert "/bring-back" not in over and refused.status_code == 409
    assert "has ended" in refused.text


async def test_date_inputs_use_the_events_date_format(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        new = (await c.get("/items/new", headers=h)).text
        edit = (await c.get(f"/items/{item['id']}/edit", headers=h)).text
    assert "type=date" not in new and "type=date" not in edit
    assert '<select class="canccu-input" name=starts_day aria-label="Starts: day">' in new
    assert '<option value="2026-11-20" selected>Fri 20 Nov</option>' in new
    assert '<option value="2026-11-21">Sat 21 Nov</option>' in new
    ends = edit.split("name=ends_day")[1].split("</select>")[0]
    assert '<option value="2026-11-20" selected>Fri 20 Nov</option>' in ends


async def test_an_archived_event_is_read_only(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    """Sheet 2 and Errors: Quick add leaves the bar and the page; an item has no delay, Edit or
    Cancel, and says why in one line (#439)."""
    h = env.writer("screen.devices.read")
    async with env.client() as c:
        show = await add(c, h, title="Show", starts_at=at(30), ends_at=at(90))
        await add(c, h, title="Quiz", starts_at=at(120))
        env.contexts["ev-a"]["status"] = "archived"
        monkeypatch.setitem(conftest.EVENT, "status", "archived")
        day = (await c.get(f"/?item={show['id']}", headers=h)).text
        item = (await c.get(f"/items/{show['id']}", headers=h)).text
        add_page = await c.get("/add", headers=h)
    why = "The event is archived, so this item can't be delayed, edited or cancelled."
    main = day.split("</header>")[1]
    assert "/agenda/add" not in main and "Full form" not in main
    assert "canccu-agenda-gap" not in day and "Add item on" not in day
    assert "delay=" not in day and "/edit" not in day and "/cancel" not in day
    assert why in day.split("canccu-agenda-side")[1] and why in item
    assert "/delay" not in item and "/edit" not in item and "/cancel" not in item
    assert add_page.status_code == 409 and "Event archived" in add_page.text
