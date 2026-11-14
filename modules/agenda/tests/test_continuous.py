"""The run of show as one continuous list (sheet 5, decision 6, #433): every day under its own
line, the past folded, the audience filter, the phone strip and the miniature's Discord line."""

from __future__ import annotations

from conftest import CREW, Env, at
from test_items import add


def _list(text: str) -> str:
    return text.split('class="canccu-card canccu-card--flush canccu-agenda-list"')[1].split(
        "</ol>"
    )[0]


def _in_order(text: str, parts: list[str]) -> bool:
    return [text.index(p) for p in parts] == sorted(text.index(p) for p in parts)


async def test_the_whole_event_is_one_list_with_a_line_per_day(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        await add(c, h, title="Show", starts_at=at(60), ends_at=at(120))
        relay = await add(c, h, title="Relay", starts_at=at(60 * 7 + 30))  # Sat 00:30
        await add(c, h, title="Breakfast", starts_at=at(60 * 15))  # Sat 08:00
        text = (await c.get("/", headers=h)).text
    listed = _list(text)
    order = ["Friday 20 November · 1 item", "Show", "Add item on Friday"]
    order += ["Saturday 21 November · 2 items", "Relay", "Breakfast", "Add item on Saturday"]
    assert _in_order(listed, order)
    assert 'id="day-2026-11-20"' in listed and 'id="day-2026-11-21"' in listed
    # A row picks its item and the page comes back to that row.
    assert f'href="/agenda/?item={relay["id"]}#r-{relay["id"]}"' in listed
    assert f'id="r-{relay["id"]}"' in listed
    # An item after midnight says its day under its time; a morning item needs no such hint.
    assert "00:30<small>Sat</small>" in listed and "08:00<small>" not in listed
    # The day switch jumps to a day's line; it marks today until the script follows the scroll.
    days = text.split('class="canccu-agenda-days"')[1].split("</nav>")[0]
    assert 'href="#day-2026-11-20" aria-current="true">Fri 20 Nov</a>' in days
    assert 'href="#day-2026-11-21">Sat 21 Nov</a>' in days
    # No line between two days: each day ends with its own add row.
    assert listed.count('class="canccu-agenda-gap"') == 1


async def test_earlier_items_fold_until_shown(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        await add(c, h, title="Crew call", kind="other", starts_at=at(-60 * 20))  # Thu 21:00
        await add(c, h, title="Doors", kind="doors", starts_at=at(-60))
        await add(c, h, title="Dinner", starts_at=at(-10), ends_at=at(50))
        folded = _list((await c.get("/", headers=h)).text)
        opened = _list((await c.get("/?earlier=1", headers=h)).text)
    fold = folded.split('class="canccu-agenda-fold"')[1].split("</li>")[0]
    assert "2 earlier items · last: Doors 16:00" in fold and ">Done</span>" in fold
    assert 'href="/agenda/?earlier=1">Show</a>' in fold
    # The folded rows are gone, with the day they emptied; what runs now stays.
    assert ">Crew call<" not in folded and ">Doors<" not in folded and ">Dinner<" in folded
    assert "Thursday 19 November" not in folded
    assert _in_order(folded, ["canccu-agenda-fold", "Friday 20 November", "Dinner"])
    assert ">Crew call<" in opened and "Thursday 19 November · 1 item" in opened
    assert 'href="/agenda/">Hide</a>' in opened.split('class="canccu-agenda-fold"')[1]


async def test_the_audience_filter_keeps_the_items_for_whom_it_names(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        await add(c, h, title="Show", starts_at=at(60))
        await add(c, h, title="Board games", visibility="attendees", starts_at=at(70))
        await add(c, h, title="Briefing", visibility="crew", starts_at=at(80))
        everyone = await c.get("/", headers=h)
        crew_only = await c.get("/?audience=crew", headers=h)
        odd = await c.get("/?audience=nobody", headers=h)
    form = everyone.text.split('class="canccu-agenda-filter"')[1].split("</form>")[0]
    assert '<option value="" selected>Everyone and crew</option>' in form
    for value, label in (("public", "Everyone"), ("attendees", "Attendees"), ("crew", "Crew")):
        assert f'<option value="{value}">{label}</option>' in form
    listed = _list(crew_only.text)
    assert ">Briefing<" in listed and ">Show<" not in listed and ">Board games<" not in listed
    assert '<option value="crew" selected>Crew</option>' in crew_only.text
    # Rows keep the filter, so picking an item does not lose it.
    assert "?audience=crew&amp;item=" in listed
    assert ">Show<" in _list(odd.text) and ">Briefing<" in _list(odd.text)


async def test_the_header_row_stays_and_the_phone_strip_keeps_now_in_view(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        dinner = await add(c, h, title="Dinner", starts_at=at(-10), ends_at=at(50))
        delay = {"revision": 1, "minutes": 15}
        await c.post(f"/api/agenda/items/{dinner['id']}/delay", json=delay, headers=h)
        text = (await c.get("/", headers=h)).text
        crew = (await c.get("/", headers=env.rights.sign_in("u_crew", CREW))).text
        css = (await c.get("/static/list.css")).text
        script = (await c.get("/static/day.js")).text
    strip = text.split('class="canccu-agenda-strip"')[1].split("</div>")[0]
    assert "<b>On now: Dinner</b> · until 18:05" in strip and "+15 min" in strip
    assert 'href="#now"' in strip and ">Now</a>" in strip
    assert 'class="canccu-agenda-head' in text and "position: sticky" in css
    # The script follows the scroll for anyone who reads the day, crew included.
    assert '<script src="/agenda/static/day.js" defer></script>' in crew
    assert "canccu-agenda-strip" in script and "canccu-agenda-dayline" in script


async def test_the_miniature_shows_the_last_discord_post(env: Env) -> None:
    h = env.writer("screen.devices.read")
    async with env.client() as c:
        before = (await c.get("/", headers=h)).text
        dinner = await add(c, h, title="Dinner", starts_at=at(-10), ends_at=at(50))
        delay = {"revision": 1, "minutes": 15}
        await c.post(f"/api/agenda/items/{dinner['id']}/delay", json=delay, headers=h)
        told = (await c.get("/", headers=h)).text
        # A quiet delay and a crew item are never posted, so the line stays as it was.
        quiet = {"revision": 2, "minutes": 5, "announce": False}
        await c.post(f"/api/agenda/items/{dinner['id']}/delay", json=quiet, headers=h)
        brief = await add(c, h, title="Briefing", visibility="crew", starts_at=at(30))
        await c.post(f"/api/agenda/items/{brief['id']}/cancel", json={"revision": 1}, headers=h)
        later = (await c.get("/", headers=h)).text
    assert "canccu-agenda-post" not in before
    post = told.split('class="canccu-agenda-post">')[1].split("</p>")[0]
    assert post.startswith("Discord, ") and "Dinner runs 15 min late, until 18:05" in post
    assert later.split('class="canccu-agenda-post">')[1].split("</p>")[0] == post
