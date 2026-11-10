"""`GET /internal/admin/settings/{module}?tenant_id=`: a module reads its own settings for the
tenant it serves, signed with its service identity (contracts/admin.md, Settings)."""

from __future__ import annotations

import json

import httpx
from canccu_kit import ServiceIdentity, tenant_scope
from conftest import SERVICE_KEY, World


def signed(caller: str) -> dict[str, str]:
    return ServiceIdentity(caller, SERVICE_KEY).headers("admin")


async def test_a_module_reads_its_own_settings_for_one_tenant(world: World) -> None:
    with tenant_scope("demo"):
        await world.service.put_settings("screen", 0, {"rotation_seconds": 20}, "u1")
    r = await world.internal.get(
        "/internal/admin/settings/screen", params={"tenant_id": "demo"}, headers=signed("screen")
    )
    other = await world.internal.get(
        "/internal/admin/settings/screen", params={"tenant_id": "other"}, headers=signed("screen")
    )
    assert r.status_code == 200
    assert r.json() == {
        "module": "screen",
        "settings_version": 1,
        "values": {"rotation_seconds": 20},
    }
    assert other.json()["settings_version"] == 0


async def test_only_the_module_itself_and_only_signed(world: World) -> None:
    query = {"tenant_id": "demo"}
    unsigned = await world.internal.get("/internal/admin/settings/screen", params=query)
    another = await world.internal.get(
        "/internal/admin/settings/screen", params=query, headers=signed("bot")
    )
    assert (unsigned.status_code, unsigned.json()["error"]["code"]) == (
        401,
        "service_unauthenticated",
    )
    assert (another.status_code, another.json()["error"]["code"]) == (403, "service_forbidden")


async def test_needs_a_valid_tenant_and_a_known_module(world: World) -> None:
    bad = await world.internal.get(
        "/internal/admin/settings/screen", params={"tenant_id": "Demo!"}, headers=signed("screen")
    )
    missing = await world.internal.get("/internal/admin/settings/screen", headers=signed("screen"))
    unknown = await world.internal.get(
        "/internal/admin/settings/nope", params={"tenant_id": "demo"}, headers=signed("nope")
    )
    assert (bad.status_code, missing.status_code, unknown.status_code) == (400, 400, 404)


async def patch(world: World, caller: str, body: object, tenant: str = "demo") -> httpx.Response:
    return await world.internal.patch(
        "/internal/admin/settings/notify",
        params={"tenant_id": tenant},
        json=body,
        headers=signed(caller),
    )


async def test_a_module_writes_only_the_keys_it_names(world: World) -> None:
    with tenant_scope("demo"):
        await world.service.put_settings("notify", 0, {"hourly_cap": 3, "topics": ["a"]}, "u1")
    world.streams.calls.clear()
    r = await patch(
        world,
        "notify",
        {"settings_version": 1, "values": {"topics": ["a", "b"]}, "actor_user_id": "u_org"},
    )
    assert r.status_code == 200
    assert r.json() == {
        "module": "notify",
        "settings_version": 2,
        "values": {"hourly_cap": 3, "topics": ["a", "b"]},
    }
    [call] = world.streams.calls
    event = json.loads(call.fields["event"])
    assert event["tenant"] == "demo"
    assert event["data"] == {
        "module": "notify",
        "keys": ["topics"],
        "settings_version": 2,
        "actor_user_id": "u_org",
    }
    with tenant_scope("other"):
        assert (await world.service.get_settings("notify"))["settings_version"] == 0


async def test_a_module_write_is_checked_like_the_session_write(world: World) -> None:
    good = {"settings_version": 0, "values": {"hourly_cap": 3}, "actor_user_id": "u_org"}
    another = await patch(world, "screen", good)
    assert (another.status_code, another.json()["error"]["code"]) == (403, "service_forbidden")
    unsigned = await world.internal.patch(
        "/internal/admin/settings/notify", params={"tenant_id": "demo"}, json=good
    )
    assert unsigned.status_code == 401
    bad: object
    for bad in (
        {**good, "values": {"hourly_cap": 0}},
        {**good, "values": {}},
        {**good, "values": {"Bad": 1}},
        {**good, "actor_user_id": ""},
        {"values": {"hourly_cap": 3}, "actor_user_id": "u"},
        [],
    ):
        r = await patch(world, "notify", bad)
        assert r.status_code == 400, bad
    assert (await patch(world, "notify", good, tenant="Demo!")).status_code == 400
    assert (await patch(world, "notify", good)).status_code == 200
    stale = await patch(world, "notify", good)
    assert (stale.status_code, stale.json()["error"]["code"]) == (409, "version_conflict")


async def test_a_module_write_needs_a_known_event_that_is_not_archived(world: World) -> None:
    good = {"settings_version": 0, "values": {"hourly_cap": 3}, "actor_user_id": "u_org"}
    archived = await patch(world, "notify", good, tenant="gone")
    assert (archived.status_code, archived.json()["error"]["code"]) == (409, "event_archived")
    unknown = await patch(world, "notify", good, tenant="nope")
    assert (unknown.status_code, unknown.json()["error"]["code"]) == (404, "not_found")
    assert world.streams.calls == []
