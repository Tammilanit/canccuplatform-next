"""Each event's configuration of the topic types (contracts/notify.md, Per-event configuration)."""

from __future__ import annotations

from typing import Any

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
