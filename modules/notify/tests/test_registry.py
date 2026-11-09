"""Registering topic types: internal, by the owner module only, checked on write, kept in a
history (contracts/notify.md, Registering)."""

from __future__ import annotations

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
    return reg


@pytest.mark.parametrize(
    "change",
    [
        "op", "formatter", "foreign event", "part", "channel", "custom key", "long title",
        "param", "crew audience",
    ],
)  # fmt: skip
async def test_a_bad_registration_is_400(env: Env, change: str) -> None:
    response = await env.register(broken(change))
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "invalid_request"
