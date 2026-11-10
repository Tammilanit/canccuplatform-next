"""Each event's configuration of the topic types (contracts/notify.md, Per-event configuration)."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from conftest import Env
from topics import play, schedule


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


async def test_the_settings_are_the_same_values_as_the_config(env: Env) -> None:
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


async def config_of(env: Env, key: str = "schedule") -> Any:
    async with env.client() as c:
        listed = (await c.get("/api/notify/topic-types", headers=env.admin())).json()
    return {t["topic_type"]["key"]: t["config"] for t in listed["topic_types"]}[key]


async def test_a_config_write_changes_admins_settings(env: Env) -> None:
    await env.register(schedule())
    await env.register(play())
    # Unset `topics` means every topic: switching one off writes all the others.
    saved = await configure(env, "schedule", {"config_version": 0, "enabled": False})
    assert saved.json()["config"]["enabled"] is False
    assert env.settings.writes == [("ev-a", {"topics": ["play"]}, "u_org")]
    lead = await configure(env, "schedule", {"config_version": 1, "params": {"lead_minutes": 15}})
    assert lead.json()["config"]["params"] == {"lead_minutes": 15}
    assert env.settings.writes[-1] == ("ev-a", {"schedule_lead_minutes": 15}, "u_org")
    back = await configure(env, "schedule", {"config_version": 2, "enabled": True})
    assert back.json()["config"]["enabled"] is True
    assert env.settings.values["ev-a"] == {
        "topics": ["play", "schedule"],
        "schedule_lead_minutes": 15,
    }
    # Writing what the settings already say writes nothing to admin; channels never go there.
    before = len(env.settings.writes)
    same = await configure(
        env, "schedule", {"config_version": 3, "enabled": True, "channels": ["push"]}
    )
    assert same.status_code == 200 and len(env.settings.writes) == before
    # The other event's settings are untouched.
    assert "ev-b" not in env.settings.values


async def test_a_settings_write_changes_the_config(env: Env) -> None:
    await env.register(schedule())
    await configure(env, "schedule", {"config_version": 0, "params": {"lead_minutes": 15}})
    # The organiser writes both in admin's settings: Notify reads them from there, nothing else
    # holds a copy, so the config shows them at once and keeps its version.
    env.settings.values["ev-a"].update({"topics": [], "schedule_lead_minutes": 5})
    config = await config_of(env)
    assert (config["enabled"], config["params"], config["config_version"]) == (
        False,
        {"lead_minutes": 5},
        1,
    )
    env.settings.values["ev-a"]["topics"] = ["schedule"]
    assert (await config_of(env))["enabled"] is True


async def test_a_conflicting_settings_write_is_computed_again_or_refused(env: Env) -> None:
    await env.register(schedule())
    await env.register(play())
    env.settings.values["ev-a"] = {"topics": ["schedule", "play"]}
    # Someone switches play off in admin while schedule is switched off here: both changes stay.
    env.settings.meanwhile = [{"topics": ["schedule"]}]
    saved = await configure(env, "schedule", {"config_version": 0, "enabled": False})
    assert saved.status_code == 200
    assert env.settings.values["ev-a"]["topics"] == []
    # Stale twice: refused, and the config write is rolled back.
    env.settings.meanwhile = [{"hourly_cap": 3}, {"hourly_cap": 4}]
    refused = await configure(env, "schedule", {"config_version": 1, "enabled": True})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "version_conflict"
    assert (await config_of(env))["config_version"] == 1


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


async def test_the_columns_admin_owns_since_251_are_gone(env: Env) -> None:
    # A copy of `enabled` or `lead_minutes` here could drift from admin's settings, the one owner.
    async with env.db.pool.acquire() as conn:
        columns = await conn.fetch(
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_name = 'notify_topic_config'"
        )
    names = {c["column_name"] for c in columns}
    assert names.isdisjoint({"enabled", "enabled_seen", "lead_seen"})
    assert {"params", "channels", "config_version"} <= names
