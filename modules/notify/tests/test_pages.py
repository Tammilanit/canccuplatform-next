"""The notification pages under admin's "Event" menu: the topic list with its configuration and
counts, and the custom-topic form (docs/plans/issue-188.md, area O)."""

from __future__ import annotations

from typing import Any

from conftest import TOPICS, Env
from topics import reminder, schedule

STATS = "notify.stats.read"
LIST = "/admin/topics"


async def topic_types(env: Env) -> dict[str, Any]:
    async with env.client() as c:
        found = (await c.get("/api/notify/topic-types", headers=env.admin())).json()
    return {t["topic_type"]["key"]: t for t in found["topic_types"]}


async def test_the_list_needs_a_session_with_a_notify_right(env: Env) -> None:
    await env.register(schedule())
    async with env.client() as c:
        anonymous = await c.get(LIST)
        assert anonymous.status_code == 303
        assert anonymous.headers["location"] == "/admin/sign-in"
        nobody = await c.get(LIST, headers=env.rights.sign_in("u_x", "admin.settings.read"))
        assert nobody.status_code == 403 and "text/html" in nobody.headers["content-type"]
        writer = await c.get(LIST, headers=env.admin())
        assert (await c.get("/static/ui.css")).status_code == 200
        assert (await c.get("/static/notify.css")).status_code == 200
        assert (await c.get("/static/other.css")).status_code == 404
    assert writer.status_code == 200
    assert writer.headers["cache-control"] == "no-store"
    assert "frame-ancestors 'none'" in writer.headers["content-security-policy"]
    assert 'aria-label="Event"' in writer.text and 'href="/notify/admin/topics"' in writer.text
    assert "Schedule" in writer.text and "<form" in writer.text
    assert "in the last 24 hours" not in writer.text  # counts need notify.stats.read


async def test_counts_need_the_stats_right_and_show_no_forms_without_the_write_right(
    env: Env,
) -> None:
    await env.register(schedule())
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(), id="e1")
    async with env.client() as c:
        stats = await c.get(LIST, headers=env.rights.sign_in("u_stats", STATS))
        both = await c.get(LIST, headers=env.rights.sign_in("u_both", STATS, TOPICS))
    assert stats.status_code == 200
    assert "<form" not in stats.text and "New topic" not in stats.text
    assert "1 in the last 24 hours, 1 in all" in stats.text
    assert "<form" in both.text and "1 in the last 24 hours" in both.text


async def test_the_form_changes_only_what_changed(env: Env) -> None:
    await env.register(schedule())
    form = {
        "config_version": "0",
        "enabled": "on",
        "channel_push": "on",
        "channel_discord_dm": "on",
        "param_lead_minutes": "10",
    }
    async with env.client() as c:
        same = await c.post(f"{LIST}/schedule", data=form, headers=env.admin())
        assert same.status_code == 303 and same.headers["location"].endswith(
            "?unchanged=schedule#schedule"
        )
        assert env.audit.entries == []
        changed = {**form, "param_lead_minutes": "15"}
        del changed["enabled"], changed["channel_discord_dm"]
        saved = await c.post(f"{LIST}/schedule", data=changed, headers=env.admin())
        assert saved.status_code == 303 and saved.headers["location"].endswith(
            "?saved=schedule#schedule"
        )
        shown = await c.get(saved.headers["location"].removeprefix("/notify"), headers=env.admin())
        assert "Saved." in shown.text
        stale = await c.post(f"{LIST}/schedule", data=changed, headers=env.admin())
        assert stale.status_code == 409 and "Someone changed this topic" in stale.text
        bad = await c.post(
            f"{LIST}/schedule",
            data={**changed, "config_version": "1", "param_lead_minutes": "0"},
            headers=env.admin(),
        )
        assert bad.status_code == 400 and "lead_minutes" in bad.text
        reader = await c.post(
            f"{LIST}/schedule", data=changed, headers=env.rights.sign_in("u_stats", STATS)
        )
        assert reader.status_code == 403
    config = (await topic_types(env))["schedule"]["config"]
    assert config == {
        "config_version": 1,
        "enabled": False,
        "params": {"lead_minutes": 15},
        "channels": ["push"],
    }


async def test_an_archived_event_shows_its_topics_without_forms(env: Env) -> None:
    await env.register(schedule())
    env.contexts["ev-a"]["status"] = "archived"
    async with env.client() as c:
        shown = await c.get(LIST, headers=env.admin())
    assert "archived" in shown.text and "<form" not in shown.text


async def test_a_custom_topic_is_made_in_two_steps(env: Env) -> None:
    await env.register(schedule())
    async with env.client() as c:
        first = await c.get(f"{LIST}/new", headers=env.admin())
        assert "name=based_on" in first.text and "Schedule" in first.text
        second = await c.get(f"{LIST}/new", params={"based_on": "schedule"}, headers=env.admin())
        # The base does not default people into Discord DMs, so neither can this topic.
        assert "name=default_event_discord_dm disabled" in second.text
        assert "name=default_event_push checked" in second.text
        assert 'value="data.item.kind"' in second.text  # a path the base uses, offered
        unknown = await c.get(f"{LIST}/new", params={"based_on": "nope"}, headers=env.admin())
        assert unknown.status_code == 200 and "name=based_on" in unknown.text
        form = {
            "based_on": "schedule",
            "name": "cosplay",
            "title": "Cosplay",
            "description": "",
            "default_event_push": "on",  # shown checked, so the browser sends it
            "where_field_0": "data.item.kind",
            "where_op_0": "eq",
            "where_value_0": "cosplay",
            "where_field_1": "data.lead_minutes",
            "where_op_1": "in",
            "where_value_1": "10, 30",
            "where_field_2": "",
        }
        empty = await c.post(
            f"{LIST}/new",
            data={**form, "where_field_0": "", "where_field_1": ""},
            headers=env.admin(),
        )
        assert empty.status_code == 400 and "where: at least one condition" in empty.text
        assert 'value="Cosplay"' in empty.text  # what was typed stays
        made = await c.post(f"{LIST}/new", data=form, headers=env.admin())
        assert made.status_code == 303 and made.headers["location"].endswith(
            "?saved=custom_cosplay#custom_cosplay"
        )
    found = (await topic_types(env))["custom_cosplay"]
    assert found["custom"]["where"] == [
        {"field": "data.item.kind", "op": "eq", "value": "cosplay"},
        {"field": "data.lead_minutes", "op": "in", "value": [10, 30]},
    ]
    # Push left on: the base's default, as the form showed it.
    assert found["topic_type"]["parts"]["event"]["defaults"] == {"push": True, "discord_dm": False}
    assert "description" not in found["topic_type"]  # left empty


async def test_a_custom_topic_is_edited_and_removed(env: Env) -> None:
    await env.register(schedule())
    async with env.client() as c:
        body = {
            "based_on": "schedule",
            "title": "Cosplay",
            "where": [
                {"field": "data.item.kind", "op": "eq", "value": "cosplay"},
                {"field": "data.lead_minutes", "op": "eq", "param": "lead_minutes"},
            ],
        }
        await c.put("/api/notify/topic-types/custom_cosplay", json=body, headers=env.admin())
        edit = await c.get(f"{LIST}/custom_cosplay/edit", headers=env.admin())
        assert edit.status_code == 200 and 'value="Cosplay"' in edit.text
        assert "kept as set through the API" in edit.text
        assert (await c.get(f"{LIST}/schedule/edit", headers=env.admin())).status_code == 404
        form = {
            "revision": "1",
            "title": "Costumes",
            "default_event_push": "",
            "where_field_0": "data.item.kind",
            "where_op_0": "in",
            "where_value_0": "cosplay, larp",
            "keep": edit.text.split('name="keep" value="')[1].split('"')[0].replace("&quot;", '"'),
        }
        del form["default_event_push"]
        saved = await c.post(f"{LIST}/custom_cosplay/edit", data=form, headers=env.admin())
        assert saved.status_code == 303
        stale = await c.post(f"{LIST}/custom_cosplay/edit", data=form, headers=env.admin())
        assert stale.status_code == 409
        found = (await topic_types(env))["custom_cosplay"]
        assert found["topic_type"]["title"] == "Costumes"
        assert found["topic_type"]["parts"]["event"]["defaults"]["push"] is False
        assert found["custom"]["where"] == [
            {"field": "data.item.kind", "op": "in", "value": ["cosplay", "larp"]},
            {"field": "data.lead_minutes", "op": "eq", "param": "lead_minutes"},
        ]
        confirm = await c.get(f"{LIST}/custom_cosplay/remove", headers=env.admin())
        assert "Remove Costumes?" in confirm.text and 'name="revision" value="2"' in confirm.text
        gone = await c.post(
            f"{LIST}/custom_cosplay/remove", data={"revision": "2"}, headers=env.admin()
        )
        assert gone.status_code == 303 and gone.headers["location"].endswith(
            "?removed=custom_cosplay"
        )
    assert "custom_cosplay" not in await topic_types(env)
