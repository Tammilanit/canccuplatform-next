"""Each event's configuration of the topic types (contracts/notify.md, Per-event configuration)."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from canccu_kit import Event
from conftest import Env
from topics import play, schedule

from canccu_notify import config as config_module


async def configure(env: Env, key: str, body: dict[str, Any], host: str = "a.example.test") -> Any:
    async with env.client(host) as c:
        return await c.put(f"/api/notify/topic-types/{key}/config", json=body, headers=env.admin())


async def test_listing_and_configuring_need_the_right(env: Env) -> None:
    await env.register(schedule())
    async with env.client() as c:
        assert (await c.get("/api/notify/topic-types")).status_code == 401
        h = env.rights.sign_in("u_x")
        assert (await c.get("/api/notify/topic-types", headers=h)).status_code == 403
        listed = (await c.get("/api/notify/topic-types", headers=env.admin())).json()
    [item] = listed["topic_types"]
    assert item["topic_type"]["key"] == "schedule"
    assert item["config"] == {
        "config_version": 0,
        "enabled": True,
        "params": {"lead_minutes": 10},
        "channels": ["push", "discord_dm"],
    }


async def test_configuration_is_versioned_checked_and_audited(env: Env) -> None:
    await env.register(schedule())
    saved = await configure(
        env, "schedule", {"config_version": 0, "params": {"lead_minutes": 15}, "channels": ["push"]}
    )
    assert saved.status_code == 200
    assert saved.json()["config"] == {
        "config_version": 1,
        "enabled": True,
        "params": {"lead_minutes": 15},
        "channels": ["push"],
    }
    assert env.audit.entries == [
        ("ev-a", "u_org", "notify.topic.configured", {"type": "topic", "id": "schedule"})
    ]
    stale = await configure(env, "schedule", {"config_version": 0, "enabled": False})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"
    for bad in (
        {"params": {"lead_minutes": 0}},
        {"params": {"lead_minutes": "10"}},
        {"params": {"other": 1}},
        {"channels": ["sms"]},
        {"enabled": "no"},
    ):
        response = await configure(env, "schedule", {"config_version": 1, **bad})
        assert response.status_code == 400, bad
    assert (await configure(env, "nope", {"config_version": 0})).status_code == 404
    # Another event keeps its own configuration.
    other = await configure(env, "schedule", {"config_version": 0}, host="b.example.test")
    assert other.json()["config"]["params"] == {"lead_minutes": 10}


async def test_the_settings_are_the_same_values_until_the_event_sets_its_own(env: Env) -> None:
    await env.register(schedule())
    await env.register(play())
    env.settings.values["ev-a"] = {"topics": ["schedule"], "schedule_lead_minutes": 5}
    async with env.client() as c:
        listed = (await c.get("/api/notify/topic-types", headers=env.admin())).json()
        configs = {t["topic_type"]["key"]: t["config"] for t in listed["topic_types"]}
        assert configs["schedule"]["params"] == {"lead_minutes": 5}
        assert not configs["play"]["enabled"]
        assert [t["topic"] for t in (await c.get("/api/notify/topics")).json()["topics"]] == [
            "schedule"
        ]
    await configure(env, "play", {"config_version": 0, "enabled": True})
    async with env.client() as c:
        topics = (await c.get("/api/notify/topics")).json()["topics"]
    by_key = {t["topic"]: t for t in topics}
    assert by_key["play"]["parts"] == {"personal": {"default": True, "needs_sign_in": True}}
    assert by_key["schedule"]["scopes"]["event"]["channels"] == ["push", "discord_dm"]


async def test_admin_down_reads_the_defaults(env: Env) -> None:
    await env.register(schedule())
    env.settings.down = True
    async with env.client() as c:
        topics = (await c.get("/api/notify/topics")).json()["topics"]
    assert [t["topic"] for t in topics] == ["schedule"]


async def test_guests_follow_the_info_page_mode(env: Env) -> None:
    await env.register(schedule())
    env.contexts["ev-a"]["info_page_mode"] = "sign_in"
    async with env.client() as c:
        assert (await c.get("/api/notify/topics")).status_code == 403
        assert (await c.get("/api/notify/topics", headers=env.admin())).status_code == 200


async def settings_changed(env: Env, keys: list[str]) -> None:
    event = Event(
        id="s1",
        type="admin.settings.changed",
        version=1,
        time="2026-11-20T17:00:00Z",
        source="admin",
        data={"module": "notify", "settings_version": 2, "keys": keys},
        tenant="ev-a",
    )
    await config_module.on_admin_event(env.deps, event)


async def test_a_setting_written_after_the_config_wins_and_the_config_after_it(env: Env) -> None:
    await env.register(schedule())
    env.settings.values["ev-a"] = {"topics": ["schedule"], "schedule_lead_minutes": 10}
    saved = await configure(
        env, "schedule", {"config_version": 0, "enabled": False, "params": {"lead_minutes": 15}}
    )
    assert saved.json()["config"]["enabled"] is False
    assert saved.json()["config"]["params"] == {"lead_minutes": 15}
    # An unrelated setting changes nothing.
    env.settings.values["ev-a"]["hourly_cap"] = 3

    async def config() -> Any:
        async with env.client() as c:
            listed = (await c.get("/api/notify/topic-types", headers=env.admin())).json()
        return listed["topic_types"][0]["config"]

    assert (await config())["enabled"] is False
    # The organiser changes both in admin's settings: the later write wins, even before the
    # event arrives (the values differ from those the config write saw).
    env.settings.values["ev-a"].update({"topics": [], "schedule_lead_minutes": 5})
    assert (await config())["params"] == {"lead_minutes": 5}
    await settings_changed(env, ["topics", "schedule_lead_minutes"])
    # Back to the value the config write saw: still the setting, as the override is gone.
    env.settings.values["ev-a"]["topics"] = ["schedule"]
    await settings_changed(env, ["topics"])
    assert (await config())["enabled"] is True
    assert (await config())["config_version"] == 3
    # And a config write after the settings wins again.
    again = await configure(
        env, "schedule", {"config_version": 3, "enabled": False, "params": {"lead_minutes": 20}}
    )
    assert again.json()["config"]["enabled"] is False
    assert (await config())["params"] == {"lead_minutes": 20}


async def test_archived_events_take_no_config_writes(env: Env) -> None:
    await env.register(schedule())
    env.contexts["ev-a"]["status"] = "archived"
    response = await configure(env, "schedule", {"config_version": 0, "enabled": False})
    assert response.status_code == 409 and response.json()["error"]["code"] == "event_archived"
    assert env.audit.entries == []
    async with env.client() as c:
        assert (await c.get("/api/notify/topic-types", headers=env.admin())).status_code == 200


async def test_two_first_writes_of_one_version_cannot_both_win(env: Env) -> None:
    await env.register(schedule())
    results = await asyncio.gather(
        *(configure(env, "schedule", {"config_version": 0, "enabled": i == 0}) for i in range(2))
    )
    assert sorted(r.status_code for r in results) == [200, 409]


async def test_a_failed_audit_rolls_the_change_back(env: Env) -> None:
    await env.register(schedule())
    env.audit.fail = True
    with pytest.raises(RuntimeError):
        await configure(env, "schedule", {"config_version": 0, "enabled": False})
    env.audit.fail = False
    assert (await configure(env, "schedule", {"config_version": 0})).status_code == 200


async def test_config_writes_wait_for_admin(env: Env) -> None:
    await env.register(schedule())
    env.settings.down = True
    response = await configure(env, "schedule", {"config_version": 0, "enabled": False})
    assert response.status_code == 503
