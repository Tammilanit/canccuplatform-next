"""The archive and retention (contracts/notify.md, Tenancy): an archived event's personal data
goes at once, its check-ins with the presence retention."""

from __future__ import annotations

from typing import Any

from canccu_kit import Event, tenant_scope
from conftest import Env, at
from test_me import seed_person
from topics import game, play

from canccu_notify import lifecycle

TABLES = (
    "notify_subscriptions", "notify_people", "notify_follows", "notify_notifications",
    "notify_deliveries", "notify_check_in_keys", "notify_check_ins", "notify_dedupe",
)  # fmt: skip


async def tenants_event(env: Env, tenant: str, type: str, data: dict[str, Any]) -> None:
    event = Event(
        id=f"t-{type}-{len(env.store.streams)}",
        type=type,
        version=1,
        time=at(0),
        source="tenants",
        data=data,
        tenant=tenant,
    )
    with tenant_scope(tenant):
        await lifecycle.handle(env.deps, event)


async def counts(env: Env, tenant: str) -> dict[str, int]:
    async with env.db.tenant(tenant) as conn:
        return {t: await conn.fetchval(f"SELECT count(*) FROM {t}") for t in TABLES}


async def test_the_archive_deletes_every_persons_data_and_stops_delivery(env: Env) -> None:
    await env.register(play())
    await env.register(game())
    await seed_person(env, "u_a")
    other = await counts(env, "ev-b")
    data = {"from": "live", "to": "archived", "actor_user_id": "u_org"}
    await tenants_event(env, "ev-a", "tenants.status.changed", data)
    left = await counts(env, "ev-a")
    assert left == {t: 0 for t in TABLES} | {"notify_check_ins": 1}  # presence: 30 days later
    assert await counts(env, "ev-b") == other
    invite = {"user_ids": ["u_a"], "game": "Chess", "host": "Host", "at": at(60)}
    await env.emit("ev-a", "games.session.invited", invite, id="late")
    assert (await counts(env, "ev-a"))["notify_notifications"] == 0
    assert env.deps.check_in_keys.get("ev-a") is None


async def test_other_status_changes_delete_nothing(env: Env) -> None:
    await env.register(play())
    await env.register(game())
    await seed_person(env, "u_a")
    before = await counts(env, "ev-a")
    await tenants_event(env, "ev-a", "tenants.status.changed", {"from": "draft", "to": "live"})
    assert await counts(env, "ev-a") == before


async def test_retention_deletes_check_ins_and_ignores_unknown_classes(env: Env) -> None:
    await env.register(play())
    await env.register(game())
    await seed_person(env, "u_a")
    await tenants_event(env, "ev-a", "tenants.retention.reached", {"data_class": "memories"})
    assert (await counts(env, "ev-a"))["notify_check_ins"] == 1
    await tenants_event(env, "ev-a", "tenants.retention.reached", {"data_class": "presence"})
    assert (await counts(env, "ev-a"))["notify_check_ins"] == 0
