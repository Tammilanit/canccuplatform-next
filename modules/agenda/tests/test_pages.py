"""The run-of-show pages: who may open them, the list, the item form and a move's preview."""

from __future__ import annotations

from conftest import CREW, Env, at
from test_items import add


async def test_pages_need_a_session_with_an_agenda_right(env: Env) -> None:
    async with env.client() as c:
        anonymous = await c.get("/")
        assert anonymous.status_code == 303
        assert anonymous.headers["location"] == "/admin/sign-in"
        nobody = await c.get("/", headers=env.rights.sign_in("u_x", "admin.settings.read"))
        assert nobody.status_code == 403 and "text/html" in nobody.headers["content-type"]
        crew = await c.get("/", headers=env.rights.sign_in("u_crew", CREW))
    assert crew.status_code == 200
    # Crew who may only read get no write actions.
    assert "Quick add</a>" not in crew.text.split("</header>")[1]
    csp = crew.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert crew.headers["cache-control"] == "no-store"


async def test_the_list_shows_the_day_with_now_delays_and_cancellations(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        await add(c, h, title="Doors", kind="doors", starts_at=at(-60))
        dinner = await add(c, h, title="Dinner", starts_at=at(-10), ends_at=at(50))
        show = await add(c, h, title="Show", starts_at=at(90), ends_at=at(120))
        gone = await add(c, h, title="Gone", starts_at=at(100))
        await c.post(f"/api/agenda/items/{gone['id']}/cancel", json={"revision": 1}, headers=h)
        await c.post(
            f"/api/agenda/items/{show['id']}/delay",
            json={"revision": 1, "minutes": 15},
            headers=h,
        )
        crew_only = await add(c, h, title="Briefing", visibility="crew", starts_at=at(30))
        response = await c.get("/", headers=h)
        tomorrow = await c.get("/?day=2026-11-21", headers=h)
    assert response.status_code == 200
    text = response.text
    order = ["Doors", "Dinner", "Now 17:00", "Briefing", "Gone", "Show"]  # Show is +15
    assert [text.index(t) for t in order] == sorted(text.index(t) for t in order)
    assert f'href="/agenda/items/{dinner["id"]}"' in text
    assert "canccu-agenda-row--running" in text and "canccu-agenda-row--cancelled" in text
    assert "+15 min" in text and "<s class=" in text  # the planned time, struck through
    assert "Crew only" in text and crew_only["id"] in text
    assert "Nothing on this day yet." in tomorrow.text


async def test_the_list_reads_times_in_the_events_time_zone(env: Env) -> None:
    env.contexts["ev-a"]["time_zone"] = "Europe/Helsinki"
    h = env.writer()
    async with env.client() as c:
        await add(c, h, title="Late", starts_at=at(60 * 6))  # 23:00 UTC is 01:00 the next day
        today = await c.get("/?day=2026-11-20", headers=h)
        next_day = await c.get("/?day=2026-11-21", headers=h)
    assert "Late" not in today.text and "Now 19:00" in today.text
    assert "Late" in next_day.text and ">01:00" in next_day.text


async def test_an_item_page_offers_the_actions_its_state_allows(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        ahead = await add(c, h, ends_at=at(120))
        running = await add(c, h, title="Running", starts_at=at(-5))
        page_ahead = (await c.get(f"/items/{ahead['id']}", headers=h)).text
        page_running = (await c.get(f"/items/{running['id']}", headers=h)).text
        crew = env.rights.sign_in("u_crew", CREW)
        page_crew = (await c.get(f"/items/{ahead['id']}", headers=crew)).text
        missing = await c.get("/items/it_nothing", headers=h)
    for action in ("delay", "show-now", "edit", "cancel"):
        assert f"/items/{ahead['id']}/{action}" in page_ahead
    # A moment that has started has no end to move and is on screens already.
    assert "/delay" not in page_running and "/show-now" not in page_running
    assert "/edit" not in page_crew
    assert missing.status_code == 404 and "text/html" in missing.headers["content-type"]


async def test_the_full_form_adds_an_item_in_the_events_time_zone(env: Env) -> None:
    env.contexts["ev-a"]["time_zone"] = "Europe/Helsinki"
    h = env.writer()
    form = {
        "title": "Quiz",
        "kind": "activity",
        "starts": "2026-11-20T20:00",
        "ends": "2026-11-20T21:30",
        "visibility": "attendees",
        "location": "Stage",
        "reminders": "15",
        "notify_own": "on",
        "notify_push": "on",
    }
    async with env.client() as c:
        new = await c.get("/items/new", headers=h)
        response = await c.post("/items/new", data=form, headers=h)
        refused = await c.post("/items/new", data={**form, "ends": form["starts"]}, headers=h)
        (item,) = (await c.get("/api/agenda/items", headers=h)).json()["items"]
    assert 'value="2026-11-20T19:01"' in new.text  # the next whole minute, local time
    assert response.status_code == 303
    assert response.headers["location"] == "/agenda/?day=2026-11-20&done=added"
    assert item["starts_at"] == at(60) and item["ends_at"] == at(150)
    assert item["visibility"] == "attendees" and item["location"] == "Stage"
    assert item["reminder_leads_minutes"] == [15] and item["notify"] == ["push"]
    assert refused.status_code == 400 and "ends_at must be after starts_at" in refused.text
    assert 'value="Quiz"' in refused.text  # nothing typed is lost


async def test_a_move_shows_its_preview_before_it_changes_anything(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        form = (await c.get(f"/items/{item['id']}/edit", headers=h)).text
        assert 'value="2026-11-20T18:00"' in form
        fields = {
            "revision": "1",
            "title": "Dinner",
            "kind": "meal",
            "starts": "2026-11-20T19:00",
            "ends": "2026-11-20T20:00",
            "visibility": "public",
        }
        preview = await c.post(f"/items/{item['id']}/edit", data=fields, headers=h)
        unchanged = (await c.get(f"/api/agenda/items/{item['id']}", headers=h)).json()
        done = await c.post(f"/items/{item['id']}/edit", data={**fields, "confirm": "1"}, headers=h)
        moved = (await c.get(f"/api/agenda/items/{item['id']}", headers=h)).json()
    assert "Dinner 18:00 → 19:00" in preview.text
    assert "nobody is told; a move is a new plan" in preview.text
    assert unchanged["revision"] == 1
    assert done.status_code == 303
    assert moved["starts_at"] == at(120) and moved["planned_starts_at"] == at(120)


async def test_editing_a_delayed_item_without_its_times_keeps_the_delay(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        await c.post(
            f"/api/agenda/items/{item['id']}/delay", json={"revision": 1, "minutes": 15}, headers=h
        )
        fields = {
            "revision": "2",
            "title": "Dinner and drinks",
            "kind": "meal",
            "starts": "2026-11-20T18:15",
            "ends": "2026-11-20T19:15",
            "visibility": "public",
        }
        response = await c.post(f"/items/{item['id']}/edit", data=fields, headers=h)
        edited = (await c.get(f"/api/agenda/items/{item['id']}", headers=h)).json()
        stale = await c.post(f"/items/{item['id']}/edit", data=fields, headers=h)
    assert response.status_code == 303
    assert edited["title"] == "Dinner and drinks" and edited["delay_minutes"] == 15
    assert env.events()[-1]["data"]["changed"] == ["title"]
    assert stale.status_code == 409 and "changed this item meanwhile" in stale.text


async def test_the_stylesheets_are_served(env: Env) -> None:
    async with env.client() as c:
        ui = await c.get("/static/ui.css")
        own = await c.get("/static/agenda.css")
        other = await c.get("/static/app.py")
    assert ui.status_code == 200 and "--canccu-color-primary" in ui.text
    assert own.status_code == 200 and own.headers["content-type"].startswith("text/css")
    assert other.status_code == 404
