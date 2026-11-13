"""Quick add, delay and cancel as sheet 5 draws them (#434): the Day field and a time after
midnight, the Length chips and a button that repeats day and time, the overlap a delay of one item
makes, Bring back after a cancel, and dates in the event's format."""

from __future__ import annotations

from datetime import UTC, datetime

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


async def test_in_the_small_hours_a_night_time_stays_on_the_calendar_day(env: Env) -> None:
    """At 00:30, "At 01:00" means in half an hour, not tomorrow night: the form offers no day of
    its own to move from. In the evening it does."""
    h = env.writer()
    async with env.client() as c:
        food = (await templates_of(c, h))["Food"]
        evening = (await c.get("/add", headers=h)).text
        env.clock[0] = datetime(2026, 11, 21, 0, 30, tzinfo=UTC)
        night = (await c.get("/add", headers=h)).text
        form = {"what": food, "when": "at", "at": "01:00", "day": "2026-11-21"}
        sent = await c.post("/add", data={**form, "title": "Snacks"}, headers=h)
        (item,) = await items(c, h)
    assert '<input type=hidden name=day_auto value="2026-11-20">' in evening
    assert "name=day_auto" not in night
    assert 'name=day value="2026-11-21" checked>' in night
    assert item["starts_at"] == "2026-11-21T01:00:00Z"
    assert "done=added&" in sent.headers["location"]


async def test_a_refused_quick_add_moves_the_day_once_when_sent_again(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        food = (await templates_of(c, h))["Food"]
        form = {"what": food, "when": "at", "at": "00:30", "day": "2026-11-20"}
        auto = {**form, "day_auto": "2026-11-20"}
        no_title = await c.post("/add", data=auto, headers=h)
        no_minutes = await c.post(
            "/add", data={**auto, "title": "Snacks", "length": "other"}, headers=h
        )
        await c.post("/add", data={**auto, "title": "Snacks"}, headers=h)
        (item,) = await items(c, h)
    for refused in (no_title, no_minutes):
        # Drawn again as sent: the day the form chose, which the next send moves once.
        assert refused.status_code == 400
        assert 'name=day value="2026-11-20" checked>' in refused.text
        assert '<input type=hidden name=day_auto value="2026-11-20">' in refused.text
    assert item["starts_at"] == "2026-11-21T00:30:00Z"


async def test_a_day_picked_by_hand_is_never_moved(env: Env) -> None:
    """The script drops the form's own day once the organiser picks one; the server then keeps
    a night time on the day sent, even after a refusal."""
    h = env.writer()
    async with env.client() as c:
        food = (await templates_of(c, h))["Food"]
        form = {"what": food, "when": "at", "at": "02:00", "day": "2026-11-20"}
        refused = await c.post("/add", data=form, headers=h)
        await c.post("/add", data={**form, "title": "Early"}, headers=h)
        (item,) = await items(c, h)
        script = (await c.get("/static/quickadd.js")).text
    assert refused.status_code == 400 and "name=day_auto" not in refused.text
    assert item["starts_at"] == "2026-11-20T02:00:00Z"
    assert 'if (e.target.name === "day" && auto) {' in script and "auto.remove();" in script


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


async def test_the_item_form_reaches_the_days_around_the_event_and_any_other(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Build and teardown days are offered; "Other date…" takes any day, typed in the event's
    format, and one it cannot read comes back as typed."""
    h = env.writer()
    monkeypatch.setitem(conftest.EVENT, "starts_at", "2026-12-05T09:00:00Z")
    monkeypatch.setitem(conftest.EVENT, "ends_at", "2026-12-06T18:00:00Z")
    form = {"title": "Build", "kind": "other", "visibility": "public", "starts_time": "10:00"}
    async with env.client() as c:
        new = (await c.get("/items/new", headers=h)).text
        await c.post("/items/new", data={**form, "starts_day": "2026-12-07"}, headers=h)
        other = {**form, "starts_day": "other", "starts_other": "Wed 13 Jan 2027"}
        await c.post("/items/new", data=other, headers=h)
        unread = await c.post(
            "/items/new", data={**other, "starts_other": "32 Jan 2027"}, headers=h
        )
        monkeypatch.setitem(conftest.EVENT, "starts_at", None)
        monkeypatch.setitem(conftest.EVENT, "ends_at", None)
        undated = (await c.get("/items/new", headers=h)).text
        teardown, later = await items(c, h)
    starts = new.split("name=starts_day")[1].split("</select>")[0]
    for day in ("Fri 20 Nov", "Sat 21 Nov", "Fri 4 Dec", "Sat 5 Dec", "Sun 6 Dec", "Mon 7 Dec"):
        assert f">{day}</option>" in starts
    assert '<option value="other">Other date…</option>' in starts
    assert 'name=starts_other value="" pattern=' in new and 'placeholder="7 Dec 2026"' in new
    assert teardown["starts_at"] == "2026-12-07T10:00:00Z"
    assert later["starts_at"] == "2027-01-13T10:00:00Z"
    assert unread.status_code == 400
    assert '<option value="other" selected>Other date…</option>' in unread.text
    assert 'name=starts_other value="32 Jan 2027"' in unread.text
    assert '<option value="other">Other date…</option>' in undated


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
