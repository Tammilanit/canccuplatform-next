"""Adding an item where it goes (sheet 5, #429): the line between two items, the row that ends
each day, and Quick add starting from them."""

from __future__ import annotations

from conftest import CREW, Env, at
from test_items import add
from test_quickadd import items, templates_of


def _list(text: str) -> str:
    return text.split('class="canccu-card canccu-card--flush canccu-agenda-list"')[1].split(
        "</ol>"
    )[0]


async def test_each_gap_names_both_neighbours_and_opens_quick_add_with_its_time(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        await add(c, h, title="Show", starts_at=at(60), ends_at=at(120))
        # Quiz ends after the raffle starts: that gap has no room, so no length.
        await add(c, h, title="Quiz", starts_at=at(195), ends_at=at(255))
        await add(c, h, title="Raffle", kind="other", starts_at=at(240))
        await add(c, h, title="Late", starts_at=at(270))
        full = (await c.get("/", headers=h)).text
        crew = (await c.get("/", headers=env.rights.sign_in("u_crew", CREW))).text
    text = _list(full)
    gaps = [
        ("/agenda/add?day=2026-11-20&amp;at=19:00&amp;minutes=75", "18:00 and 20:15"),
        ("/agenda/add?day=2026-11-20&amp;at=21:00", "20:15 and 21:00"),
        ("/agenda/add?day=2026-11-20&amp;at=21:00&amp;minutes=30", "21:00 and 21:30"),
    ]
    for href, names in gaps:
        assert f'href="{href}">' in text and f"Add between {names}</a>" in text
    # Each line stands between its two rows, and the day's own row ends the list.
    order = ["Show", "18:00 and 20:15", "Quiz", "20:15 and 21:00", "Raffle", "Late"]
    order += ["Add item on Friday"]
    assert [text.index(t) for t in order] == sorted(text.index(t) for t in order)
    assert text.count('class="canccu-agenda-gap"') == 3
    assert 'href="/agenda/add?day=2026-11-20">' in text.split("canccu-agenda-addrow")[1]
    # A phone shows a line on a long press, and the bar's Quick add follows the gap in view.
    assert '<script src="/agenda/static/day.js" defer></script>' in full.split("</header>")[1]
    # Crew who only read get no way to add.
    assert "canccu-agenda-gap" not in crew and "Add item on" not in crew


async def test_the_day_script_is_served(env: Env) -> None:
    async with env.client() as c:
        script = await c.get("/static/day.js")
    assert script.status_code == 200
    assert script.headers["content-type"].startswith("text/javascript")
    assert "canccu-agenda-gap" in script.text and "canccu-tabbar__add" in script.text


async def test_quick_add_opens_with_the_gaps_time_and_length(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        page = (await c.get("/add?day=2026-11-21&at=19:00&minutes=75", headers=h)).text
        plain = (await c.get("/add", headers=h)).text
        odd = (await c.get("/add?at=29:00&minutes=-5", headers=h)).text
    assert 'name=when value="at" checked' in page
    assert 'name=at value="19:00"' in page and 'name=minutes value="75"' in page
    assert 'name=day value="2026-11-21"' in page
    # Without a gap: now, and the template's length.
    assert 'name=when value="now" checked' in plain and 'name=minutes value=""' in plain
    # What is not a time or a length is left out, not shown back.
    assert 'name=when value="now" checked' in odd and "29:00" not in odd and 'value="-5"' not in odd


async def test_quick_add_takes_the_length_the_form_sets(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        food = (await templates_of(c, h))["Food"]
        form = {"what": food, "when": "at", "at": "19:00", "day": "2026-11-20"}
        await c.post("/add", data={**form, "title": "Short meal", "minutes": "25"}, headers=h)
        later = {**form, "at": "20:00"}
        await c.post("/add", data={**later, "title": "Usual meal", "minutes": ""}, headers=h)
        await c.post(
            "/add",
            data={**form, "at": "21:00", "what": "kind:activity", "title": "Talk", "minutes": "45"},
            headers=h,
        )
        bad = await c.post("/add", data={**form, "title": "Odd", "minutes": "0"}, headers=h)
        short, usual, talk = await items(c, h)
    assert short["starts_at"] == at(120) and short["ends_at"] == at(145)
    assert usual["ends_at"] == at(240)  # the template's 60 minutes
    assert talk["starts_at"] == at(240) and talk["ends_at"] == at(285)
    assert bad.status_code == 400 and "length" in bad.text and 'value="Odd"' in bad.text


async def test_a_length_or_time_too_long_to_read_is_refused_not_a_crash(env: Env) -> None:
    """int() refuses a string over 4300 digits with a ValueError, which the form does not catch
    (#479): a crafted value must be dropped or refused like any other wrong one."""
    h = env.writer()
    huge = "9" * 5000
    async with env.client() as c:
        food = (await templates_of(c, h))["Food"]
        form = {"what": food, "title": "Odd", "when": "at", "at": "19:00", "day": "2026-11-20"}
        opened = await c.get(f"/add?at=19:00&minutes={huge}", headers=h)
        length = await c.post("/add", data={**form, "minutes": huge}, headers=h)
        other = await c.post("/add", data={**form, "length": "other", "minutes": huge}, headers=h)
        time = await c.post("/add", data={**form, "at": huge}, headers=h)
        assert await items(c, h) == []
    assert opened.status_code == 200 and huge not in opened.text
    assert length.status_code == 400 and "1 to 1440" in length.text
    assert other.status_code == 400 and "1 to 1440" in other.text
    assert time.status_code == 400 and "pick a time" in time.text
