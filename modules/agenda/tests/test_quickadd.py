"""Quick-add and the templates it fills items from."""

from __future__ import annotations

from typing import Any

import httpx
from conftest import Env, at


async def choices_of(c: httpx.AsyncClient, h: dict[str, str]) -> list[tuple[str, str]]:
    """The quick-add choices (label, value), read from the quick-add page."""
    page = (await c.get("/add", headers=h)).text
    out = []
    for part in page.split('name=what value="')[1:]:
        value, rest = part.split('"', 1)
        out.append((rest.split("<span>")[1].split("</span>")[0], value))
    return out


async def templates_of(c: httpx.AsyncClient, h: dict[str, str]) -> dict[str, str]:
    """Template name → its quick-add choice."""
    return {label: v for label, v in await choices_of(c, h) if v.startswith("t:")}


async def items(c: httpx.AsyncClient, h: dict[str, str]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = (await c.get("/api/agenda/items", headers=h)).json()["items"]
    return result


async def test_a_new_event_has_the_three_starter_templates(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        choices = await choices_of(c, h)
        listed = (await c.get("/templates", headers=h)).text
    assert [label for label, _ in choices[:4]] == ["Food", "Ceremony", "Game session", "Doors"]
    assert "Meal · 60 min" in listed and "Activity · 120 min" in listed
    # Kinds follow; quiet hours need an end, so only a template offers them.
    assert ("Quiet hours", "k:quiet_hours") not in choices


async def test_quick_add_now_from_a_template(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        food = (await templates_of(c, h))["Food"]
        response = await c.post(
            "/add", data={"title": "Pizza", "what": food, "when": "now"}, headers=h
        )
        (item,) = await items(c, h)
    assert response.status_code == 303
    assert response.headers["location"] == "/agenda/?day=2026-11-20&done=added"
    assert item["title"] == "Pizza" and item["kind"] == "meal"
    assert item["starts_at"] == at(1) and item["ends_at"] == at(61)
    assert env.events()[-1]["type"] == "agenda.item.added"


async def test_quick_add_in_30_minutes_or_at_a_time_with_a_kind(env: Env) -> None:
    env.contexts["ev-a"]["time_zone"] = "Europe/Helsinki"
    h = env.writer()
    async with env.client() as c:
        await c.post(
            "/add",
            data={"title": "Soon", "what": "k:activity", "when": "in30", "location": "Hall"},
            headers=h,
        )
        await c.post(
            "/add",
            data={
                "title": "Later",
                "what": "k:doors",
                "when": "at",
                "at": "08:30",
                "day": "2026-11-21",
            },
            headers=h,
        )
        soon, later = await items(c, h)
    assert soon["starts_at"] == at(30) and soon["ends_at"] is None
    assert soon["location"] == "Hall" and soon["visibility"] == "public"
    assert later["starts_at"] == "2026-11-21T06:30:00Z" and later["kind"] == "doors"


async def test_quick_add_refusals_keep_what_was_typed(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        nothing = await c.post("/add", data={"title": "Raffle", "when": "now"}, headers=h)
        no_time = await c.post(
            "/add", data={"title": "Raffle", "what": "k:other", "when": "at"}, headers=h
        )
        crew = env.rights.sign_in("u_crew", "agenda.crew.read")
        reader = await c.post(
            "/add", data={"title": "X", "what": "k:other", "when": "now"}, headers=crew
        )
        assert await items(c, h) == []
    assert nothing.status_code == 400 and "pick what it is" in nothing.text
    assert 'value="Raffle"' in nothing.text
    assert no_time.status_code == 400 and "pick a time" in no_time.text
    assert reader.status_code == 403


async def test_templates_are_added_edited_and_removed(env: Env) -> None:
    h = env.writer()
    form = {
        "name": "Raffle",
        "kind": "activity",
        "minutes": "20",
        "visibility": "attendees",
        "location": "Info desk",
        "reminders": "5",
        "notify_own": "on",
        "notify_discord_channel": "on",
    }
    async with env.client() as c:
        created = await c.post("/templates/new", data=form, headers=h)
        raffle = (await templates_of(c, h))["Raffle"]
        tid = raffle.removeprefix("t:")
        await c.post(
            "/add", data={"title": "Raffle draw", "what": raffle, "when": "now"}, headers=h
        )
        edit = await c.get(f"/templates/{tid}", headers=h)
        await c.post(f"/templates/{tid}", data={**form, "minutes": ""}, headers=h)
        quiet = await c.post(
            "/templates/new", data={**form, "kind": "quiet_hours", "minutes": ""}, headers=h
        )
        after = (await c.get("/templates", headers=h)).text
        await c.post(f"/templates/{tid}/delete", headers=h)
        gone = await c.get(f"/templates/{tid}", headers=h)
        (item,) = await items(c, h)
    assert created.status_code == 303
    assert item["kind"] == "activity" and item["ends_at"] == at(21)
    assert item["visibility"] == "attendees" and item["location"] == "Info desk"
    assert item["reminder_leads_minutes"] == [5] and item["notify"] == ["discord_channel"]
    assert 'value="Info desk"' in edit.text and 'value="5"' in edit.text
    assert 'Raffle</span><span class="canccu-agenda-row__meta">Activity · a moment' in after
    assert quiet.status_code == 400 and "needs a length" in quiet.text
    assert gone.status_code == 404


async def test_removed_starters_do_not_come_back(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        for value in (await templates_of(c, h)).values():
            await c.post(f"/templates/{value.removeprefix('t:')}/delete", headers=h)
        listed = (await c.get("/templates", headers=h)).text
    assert "No templates yet." in listed
