"""Registering topic types: internal, by the owner module only, checked on write, kept in a
history (contracts/notify.md, Registering)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from conftest import Env
from topics import play, schedule


async def history(env: Env) -> list[Any]:
    async with env.db.platform() as conn:
        return list(await conn.fetch("SELECT * FROM notify_topic_type_history ORDER BY id"))


async def test_a_module_registers_its_type_once_and_again_idempotently(env: Env) -> None:
    reg = schedule()
    first = await env.register(reg)
    assert first.status_code == 200 and first.json() == reg
    assert (await env.register(reg)).status_code == 200
    assert len(await history(env)) == 1
    changed = {**reg, "title": "Run of show"}
    assert (await env.register(changed)).json()["title"] == "Run of show"
    rows = await history(env)
    assert len(rows) == 2 and rows[1]["old"] is not None


async def test_only_the_owner_registers_and_keys_are_not_taken_over(env: Env) -> None:
    assert (await env.register(schedule(), module="games")).status_code == 403
    assert (await env.register(schedule())).status_code == 200
    stolen = {**play(), "key": "schedule", "triggers": play()["triggers"]}
    response = await env.register(stolen)
    assert response.status_code == 409 and response.json()["error"]["code"] == "topic_owned"


async def test_internal_paths_need_a_module_identity(env: Env) -> None:
    async with env.internal() as c:
        response = await c.put("/internal/notify/topic-types/schedule", json=schedule())
    assert response.status_code == 401


async def test_the_history_is_append_only_for_the_module(env: Env) -> None:
    await env.register(schedule())
    with pytest.raises(Exception, match="permission denied"):
        async with env.db.platform() as conn:
            await conn.execute("DELETE FROM notify_topic_type_history")


def broken(change: str) -> dict[str, Any]:
    reg = schedule()
    t = reg["triggers"][0]
    if change == "op":
        t["where"][0]["op"] = "like"
    elif change == "formatter":
        t["title"] = "{data.item.starts_at|weekday}"
    elif change == "foreign event":
        t["event"] = "games.surge.started"
    elif change == "part":
        t["part"] = "personal"
    elif change == "channel":
        reg["parts"]["event"]["channels"] = ["sms"]
    elif change == "custom key":
        reg["key"] = "custom_x"
    elif change == "long title":
        t["title"] = "x" * 201
    elif change == "param":
        t["where"][1]["param"] = "nope"
    elif change == "crew audience":
        t["audience"] = {"value": "crew"}
    elif change == "list audience":
        t["audience"] = {"value": ["public"]}
    elif change == "object scope":
        reg["parts"]["event"]["scope"] = {"x": 1}
    elif change == "list part":
        t["part"] = ["event"]
    elif change == "list op":
        t["where"][0]["op"] = ["eq"]
    elif change == "object param":
        t["where"][1]["param"] = {"x": 1}
    elif change == "object channel":
        reg["parts"]["event"]["channels"] = [{"x": 1}]
    elif change == "string dedupe":
        t["dedupe_by"] = "correlation_id"
    elif change == "bool expiry":
        del t["expires_at"]
        t["expires_after_minutes"] = True
    elif change == "no expiry":
        del t["expires_at"]
    return reg


@pytest.mark.parametrize(
    "change",
    [
        "op", "formatter", "foreign event", "part", "channel", "custom key", "long title",
        "param", "crew audience", "list audience", "object scope", "list part", "list op",
        "object param", "object channel", "string dedupe", "bool expiry", "no expiry",
    ],
)  # fmt: skip
async def test_a_bad_registration_is_400(env: Env, change: str) -> None:
    response = await env.register(broken(change))
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "invalid_request"


async def test_two_first_registrations_of_one_key_keep_one_owner(env: Env) -> None:
    mine = {**play(), "key": "shared"}
    theirs = {**schedule(), "key": "shared"}
    results = await asyncio.gather(env.register(mine), env.register(theirs))
    assert sorted(r.status_code for r in results) == [200, 409]
    async with env.db.platform() as conn:
        row = await conn.fetchrow("SELECT owner, registration FROM notify_topic_types")
    assert json.loads(row["registration"])["owner"] == row["owner"]
    assert len(await history(env)) == 1


async def test_entity_merges_and_removals_are_the_owners_own_events(env: Env) -> None:
    from topics import game

    reg = game()
    reg["parts"]["personal"]["entity"]["merged"]["event"] = "pizza.order.merged"
    assert (await env.register(reg)).status_code == 400
    reg = game()
    reg["parts"]["personal"]["entity"]["removed"]["id"] = "Not A Path"
    assert (await env.register(reg)).status_code == 400
    assert (await env.register(game())).status_code in (200, 201)
