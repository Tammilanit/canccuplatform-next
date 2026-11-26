"""Notifications in plain words, and Advanced that explains itself (#782 part C, plan D12, D13;
sheets 01 and 02): each kind with an example and one switch, the advanced forms grouped by the
part they come from, and the custom editor's choices as lists."""

from __future__ import annotations

import html
import re
from typing import Any

from canccu_kit.page_check import page_problems
from conftest import Env
from test_pages import topic_types
from topics import schedule

LIST = "/admin/topics"
ADVANCED = "/admin/topics/advanced"
SENTENCE = (
    "Choose what attendees can be notified about. "
    "Each person picks which of these they want in their hub."
)


def card(page: str, key: str) -> str:
    found = re.search(rf'<section[^>]*id="{key}".*?</section>', page, re.S)
    assert found, key
    return found.group(0)


def hidden_of(form: str) -> dict[str, str]:
    found = re.findall(r'<input type=hidden name="([^"]+)" value="([^"]*)">', form)
    return {name: html.unescape(value) for name, value in found}


async def get(env: Env, path: str, **params: str) -> str:
    async with env.client() as c:
        r = await c.get(path, params=params, headers=env.admin())
    assert r.status_code == 200, r.text
    return r.text


async def test_the_page_opens_with_its_sentence_and_both_pages_pass_the_rules(env: Env) -> None:
    await env.register(schedule())
    page = await get(env, LIST)
    assert SENTENCE in html.unescape(page)
    assert page_problems(page) == []
    assert page_problems(await get(env, ADVANCED)) == []
    assert 'href="/notify/admin/topics/advanced"' in page


async def test_each_kind_shows_its_example_and_a_switch(env: Env) -> None:
    await env.register(schedule())
    kind = card(await get(env, LIST), "schedule")
    assert "Opening ceremony at" in kind and "Starts in 10 min" in kind
    assert "Example of what a phone shows" in kind
    assert "role=switch" in kind and "name=enabled" in kind and "Run of show" in kind
    assert 'class="canccu-tip__info"' in kind  # the switch says what it does


async def test_switching_posts_only_enabled_and_keeps_everything_else(env: Env) -> None:
    await env.register(schedule())
    page = await get(env, LIST)
    form = card(page, "schedule").split("<form")[1]
    values = hidden_of(form)
    assert values["only"] == "enabled"
    async with env.client() as c:
        # The switch unticked: a browser sends no `enabled`, and no channel or parameter field.
        r = await c.post(f"{LIST}/schedule", data=values, headers=env.admin())
        assert r.status_code == 303 and "switched=schedule" in r.headers["location"]
        shown = await c.get(r.headers["location"].removeprefix("/notify"), headers=env.admin())
    config = (await topic_types(env))["schedule"]["config"]
    assert config["enabled"] is False
    assert config["channels"] == ["push", "discord_dm"] and config["params"] == {"lead_minutes": 10}
    assert "Saved. Schedule is now off for everyone." in shown.text
    undo = shown.text.split("Saved. Schedule is now off")[1].split("</form>")[0]
    assert "Undo" in undo and 'name=enabled value="on"' in undo


async def test_advanced_groups_kinds_by_the_part_they_come_from(env: Env) -> None:
    await env.register(schedule())
    async with env.client() as c:
        body = {
            "based_on": "schedule",
            "title": "Cosplay",
            "where": [{"field": "data.item.kind", "op": "eq", "value": "cosplay"}],
        }
        await c.put("/api/notify/topic-types/custom_cosplay", json=body, headers=env.admin())
    page = await get(env, ADVANCED)
    run_of_show = page.index('id="group-agenda"')
    own = page.index('id="group-own"')
    assert run_of_show < page.index('id="schedule"') < own < page.index('id="custom_cosplay"')
    assert "Your own kinds" in page


async def test_channels_read_in_words_each_with_a_tooltip(env: Env) -> None:
    await env.register(schedule())
    kind = card(await get(env, ADVANCED), "schedule")
    for words in ("Phone notification", "Discord message"):
        assert re.search(rf"{words}</label>\s*<span class=\"canccu-tip\">", kind), words
    assert "Push" not in kind and "Discord DM" not in kind


async def test_lead_time_is_a_stepper_with_quick_picks(env: Env) -> None:
    await env.register(schedule())
    kind = card(await get(env, ADVANCED), "schedule")
    assert re.search(r'type=number name=param_lead_minutes value="10" min="1" max="1440"', kind)
    assert kind.count("data-canccu-step") == 2
    picks = re.findall(r"data-canccu-pick=(\d+)", kind)
    assert picks == ["5", "10", "15", "30"]
    assert "min" in kind  # the unit beside the number


async def test_every_advanced_control_has_a_tooltip(env: Env) -> None:
    await env.register(schedule())
    kind = card(await get(env, ADVANCED), "schedule")
    form = kind.split("<form", 1)[1]
    controls = len(re.findall(r"<input class=canccu-switch|<input class=\"canccu-input\"", form))
    assert controls >= 4  # on, two channels, the lead time
    assert form.count('class="canccu-tip__info"') >= controls


async def test_the_custom_editor_offers_lists(env: Env) -> None:
    await env.register(schedule())
    env.hub.kinds = [{"key": "meal", "name": "Meal"}, {"key": "cosplay", "name": "Cosplay"}]
    page = await get(env, f"{LIST}/new", based_on="schedule")
    first = page.split('class="canccu-notify-condition"')[1]
    assert '<select class="canccu-input" name=where_field_0>' in first
    assert '<option value="data.item.kind">Item kind</option>' in first
    assert ">is not</option>" in first
    assert '<option value="cosplay">Cosplay</option>' in page
    assert env.hub.asked_kinds and env.hub.asked_kinds[-1][1] is not None  # as the person


async def test_agenda_not_answering_leaves_the_value_as_text(env: Env) -> None:
    await env.register(schedule())
    env.hub.kinds = None
    page = await get(env, f"{LIST}/new", based_on="schedule")
    assert "name=where_value_0" in page and '<option value="cosplay">' not in page
    assert 'id="canccu-notify-kinds"' not in page


async def test_a_custom_topic_saved_from_the_lists_equals_the_typed_body(env: Env) -> None:
    await env.register(schedule())
    form: dict[str, Any] = {
        "based_on": "schedule",
        "name": "meals",
        "title": "Meals",
        "default_event_push": "on",
        "where_field_0": "data.item.kind",
        "where_op_0": "eq",
        "where_value_0": "meal",
    }
    async with env.client() as c:
        made = await c.post(f"{LIST}/new", data=form, headers=env.admin())
    assert made.status_code == 303
    found = (await topic_types(env))["custom_meals"]
    assert found["custom"]["where"] == [{"field": "data.item.kind", "op": "eq", "value": "meal"}]
