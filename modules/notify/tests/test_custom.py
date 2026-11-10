"""An event's own topics, narrowed from a registered one (contracts/notify.md, Custom topics)."""

from __future__ import annotations

from typing import Any

from conftest import Env
from topics import play, reminder, schedule

COSPLAY = {
    "based_on": "schedule",
    "title": "Cosplay",
    "description": "Cosplay reminders only",
    "where": [{"field": "data.item.kind", "op": "eq", "value": "cosplay"}],
}


async def save(env: Env, key: str, body: dict[str, Any], host: str = "a.example.test") -> Any:
    async with env.client(host) as c:
        return await c.put(f"/api/notify/topic-types/{key}", json=body, headers=env.admin())


async def remove(env: Env, key: str, revision: Any) -> Any:
    async with env.client() as c:
        return await c.delete(
            f"/api/notify/topic-types/{key}", params={"revision": revision}, headers=env.admin()
        )


async def listed(env: Env) -> dict[str, Any]:
    async with env.client() as c:
        found = (await c.get("/api/notify/topic-types", headers=env.admin())).json()
    return {t["topic_type"]["key"]: t for t in found["topic_types"]}


async def test_a_custom_topic_narrows_its_base_and_is_audited(env: Env) -> None:
    await env.register(schedule())
    made = await save(env, "custom_cosplay", COSPLAY)
    assert made.status_code == 201
    body = made.json()
    assert body["custom"] == {"based_on": "schedule", "where": COSPLAY["where"], "revision": 1}
    reg = body["topic_type"]
    assert reg["key"] == "custom_cosplay" and reg["title"] == "Cosplay"
    assert reg["owner"] == "agenda" and reg["params"] == schedule()["params"]
    # Every trigger of the base, with the custom conditions added to its own.
    assert len(reg["triggers"]) == len(schedule()["triggers"])
    for mine, base in zip(reg["triggers"], schedule()["triggers"], strict=True):
        assert mine["where"] == base["where"] + COSPLAY["where"]
    assert body["config"]["enabled"] is True
    assert env.audit.entries == [
        ("ev-a", "u_org", "notify.custom_topic.saved", {"type": "topic", "id": "custom_cosplay"})
    ]
    assert set(await listed(env)) == {"schedule", "custom_cosplay"}
    async with env.client() as c:
        topics = {t["topic"]: t for t in (await c.get("/api/notify/topics")).json()["topics"]}
    assert topics["custom_cosplay"]["custom"] is True
    assert topics["custom_cosplay"]["description"] == "Cosplay reminders only"
    assert topics["schedule"]["custom"] is False
    # Another event does not have it.
    async with env.client("b.example.test") as c:
        other = (await c.get("/api/notify/topic-types", headers=env.admin())).json()
    assert [t["topic_type"]["key"] for t in other["topic_types"]] == ["schedule"]


async def test_bad_custom_topics_are_refused(env: Env) -> None:
    await env.register(schedule())
    await env.register(play())
    await save(env, "custom_cosplay", COSPLAY)
    for key, change in (
        ("cosplay", {}),
        ("custom_Bad", {}),
        ("custom_x", {"based_on": "nope"}),
        ("custom_x", {"based_on": "custom_cosplay"}),
        ("custom_x", {"title": ""}),
        ("custom_x", {"where": []}),
        ("custom_x", {"where": [{"field": "data.item.kind", "op": "like", "value": "x"}]}),
        ("custom_x", {"where": [{"field": "data.x", "op": "eq", "param": "nope"}]}),
        # A default may be true only where the base's is: schedule's discord_dm is false.
        ("custom_x", {"defaults": {"event": {"discord_dm": True}}}),
        ("custom_x", {"defaults": {"personal": {"push": False}}}),
        ("custom_x", {"defaults": {"event": {"sms": False}}}),
        ("custom_x", {"description": "x" * 201}),
    ):
        response = await save(env, key, {**COSPLAY, **change})
        assert response.status_code == 400, (key, change)
        assert response.json()["error"]["code"] == "invalid_request"
    assert (await save(env, "custom_x", {**COSPLAY, "revision": 0})).status_code == 400
    # Switching a default off is allowed.
    off = await save(env, "custom_quiet", {**COSPLAY, "defaults": {"event": {"push": False}}})
    assert off.status_code == 201
    assert off.json()["topic_type"]["parts"]["event"]["defaults"] == {
        "push": False,
        "discord_dm": False,
    }


async def test_revisions_replace_and_remove(env: Env) -> None:
    await env.register(schedule())
    assert (await save(env, "custom_cosplay", COSPLAY)).status_code == 201
    taken = await save(env, "custom_cosplay", COSPLAY)
    assert taken.status_code == 409 and taken.json()["error"]["code"] == "topic_exists"
    replaced = await save(env, "custom_cosplay", {**COSPLAY, "title": "Costumes", "revision": 1})
    assert replaced.status_code == 200
    assert replaced.json()["custom"]["revision"] == 2
    assert replaced.json()["topic_type"]["title"] == "Costumes"
    stale = await save(env, "custom_cosplay", {**COSPLAY, "revision": 1})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"
    missing = await save(env, "custom_other", {**COSPLAY, "revision": 1})
    assert missing.status_code == 409
    assert (await remove(env, "custom_cosplay", 1)).status_code == 409
    assert (await remove(env, "custom_nope", 1)).status_code == 404
    assert (await remove(env, "custom_cosplay", "x")).status_code == 400
    assert (await remove(env, "custom_cosplay", 2)).status_code == 204
    assert set(await listed(env)) == {"schedule"}
    assert env.audit.entries[-1] == (
        "ev-a",
        "u_org",
        "notify.custom_topic.removed",
        {"type": "topic", "id": "custom_cosplay"},
    )
    # Its configuration went with it: the key can be taken again from the start.
    await save(env, "custom_cosplay", COSPLAY)
    async with env.client() as c:
        await c.put(
            "/api/notify/topic-types/custom_cosplay/config",
            json={"config_version": 0, "channels": ["push"]},
            headers=env.admin(),
        )
    assert (await remove(env, "custom_cosplay", 1)).status_code == 204
    again = await save(env, "custom_cosplay", COSPLAY)
    assert again.status_code == 201 and again.json()["config"]["config_version"] == 0


async def test_writes_need_the_right_and_a_live_event(env: Env) -> None:
    await env.register(schedule())
    async with env.client() as c:
        url = "/api/notify/topic-types/custom_cosplay"
        assert (await c.put(url, json=COSPLAY)).status_code == 401
        h = env.rights.sign_in("u_x")
        assert (await c.put(url, json=COSPLAY, headers=h)).status_code == 403
    env.contexts["ev-a"]["status"] = "archived"
    archived = await save(env, "custom_cosplay", COSPLAY)
    assert archived.status_code == 409 and archived.json()["error"]["code"] == "event_archived"
    assert env.audit.entries == []


async def test_a_custom_topic_reaches_no_channel_its_base_does_not(env: Env) -> None:
    await env.register(schedule())
    async with env.client() as c:
        await c.put(
            "/api/notify/topic-types/schedule/config",
            json={"config_version": 0, "channels": ["push"]},
            headers=env.admin(),
        )
    made = (await save(env, "custom_cosplay", COSPLAY)).json()
    assert made["config"]["channels"] == ["push"]
    # The custom topic's own configuration narrows further but never widens.
    async with env.client() as c:
        url = "/api/notify/topic-types/custom_cosplay/config"
        wide = await c.put(
            url, json={"config_version": 0, "channels": ["push", "discord_dm"]}, headers=env.admin()
        )
        assert wide.status_code == 200 and wide.json()["config"]["channels"] == ["push"]
        params = await c.put(
            url, json={"config_version": 1, "params": {"lead_minutes": 30}}, headers=env.admin()
        )
    assert params.json()["config"]["params"] == {"lead_minutes": 30}
    # The base keeps its own parameter.
    assert (await listed(env))["schedule"]["config"]["params"] == {"lead_minutes": 10}


async def test_a_custom_topic_is_offered_even_when_the_settings_list_the_topics(env: Env) -> None:
    await env.register(schedule())
    env.settings.values["ev-a"] = {"topics": ["schedule"]}
    made = await save(env, "custom_cosplay", COSPLAY)
    assert made.json()["config"]["enabled"] is True
    assert env.settings.writes == [("ev-a", {"topics": ["schedule", "custom_cosplay"]}, "u_org")]
    gone = await remove(env, "custom_cosplay", 1)
    assert gone.status_code == 204
    assert env.settings.values["ev-a"]["topics"] == ["schedule"]


async def test_matching_events_make_both_and_the_inbox_shows_the_custom_one(env: Env) -> None:
    await env.register(schedule())
    await save(env, "custom_cosplay", COSPLAY)
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(kind="cosplay"), id="e1")
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(id="it2"), id="e2")
    async with env.db.tenant("ev-a") as conn:
        made = await conn.fetch(
            "SELECT topic, based_on, source_event_id FROM notify_notifications ORDER BY topic"
        )
    assert [(r["topic"], r["based_on"], r["source_event_id"]) for r in made] == [
        ("custom_cosplay", "schedule", "e1"),
        ("schedule", None, "e1"),
        ("schedule", None, "e2"),
    ]
    async with env.client() as c:
        inbox = (await c.get("/api/notify/inbox", headers=env.admin())).json()["notifications"]
    assert sorted(n["topic"] for n in inbox) == ["custom_cosplay", "schedule"]
    by_topic = {n["topic"]: n for n in inbox}
    assert by_topic["schedule"]["title"].startswith("Dinner")


async def test_a_personal_custom_topic_collapses_per_recipient(env: Env) -> None:
    await env.register(play())
    await save(
        env,
        "custom_chess",
        {
            "based_on": "play",
            "title": "Chess",
            "where": [{"field": "data.game", "op": "eq", "value": "chess"}],
        },
    )
    data = {"game": "chess", "host": "h", "at": "2026-11-20T18:00:00Z", "user_ids": ["u_a", "u_b"]}
    await env.emit("ev-a", "games.session.invited", data, id="e1")
    other = {**data, "game": "go", "user_ids": ["u_a"]}
    await env.emit("ev-a", "games.session.invited", other, id="e2")
    async with env.client() as c:
        a = (await c.get("/api/notify/inbox", headers=env.rights.sign_in("u_a"))).json()
        b = (await c.get("/api/notify/inbox", headers=env.rights.sign_in("u_b"))).json()
    assert sorted(n["topic"] for n in a["notifications"]) == ["custom_chess", "play"]
    assert [n["title"] for n in a["notifications"] if n["topic"] == "play"] == ["go with h"]
    assert [n["topic"] for n in b["notifications"]] == ["custom_chess"]


async def test_a_disabled_custom_topic_makes_nothing_and_its_base_shows(env: Env) -> None:
    await env.register(schedule())
    await save(env, "custom_cosplay", COSPLAY)
    async with env.client() as c:
        await c.put(
            "/api/notify/topic-types/custom_cosplay/config",
            json={"config_version": 0, "enabled": False},
            headers=env.admin(),
        )
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(kind="cosplay"), id="e1")
    async with env.client() as c:
        inbox = (await c.get("/api/notify/inbox", headers=env.admin())).json()["notifications"]
        topics = (await c.get("/api/notify/topics")).json()["topics"]
    assert [n["topic"] for n in inbox] == ["schedule"]
    assert [t["topic"] for t in topics] == ["schedule"]


async def test_a_new_custom_topic_never_shrinks_an_unset_topics_setting(env: Env) -> None:
    await env.register(schedule())
    env.settings.values["ev-a"] = {"topics": ["schedule"]}
    # Meanwhile someone resets `topics` to unset, which means every topic.
    env.settings.meanwhile = [{"topics": None}]
    made = await save(env, "custom_cosplay", COSPLAY)
    assert made.status_code == 201
    assert env.settings.writes == [] and env.settings.values["ev-a"]["topics"] is None
    assert {t["config"]["enabled"] for t in (await listed(env)).values()} == {True}


async def test_a_new_base_drops_the_parameters_of_the_old_one(env: Env) -> None:
    await env.register(schedule())
    await env.register(play())
    await save(env, "custom_cosplay", COSPLAY)
    async with env.client() as c:
        await c.put(
            "/api/notify/topic-types/custom_cosplay/config",
            json={"config_version": 0, "params": {"lead_minutes": 30}},
            headers=env.admin(),
        )
    chess = {
        "based_on": "play",
        "title": "Chess",
        "where": [{"field": "data.game", "op": "eq", "value": "chess"}],
        "revision": 1,
    }
    moved = await save(env, "custom_cosplay", chess)
    assert moved.status_code == 200 and moved.json()["config"]["params"] == {}
