"""`GET /internal/admin/settings/{module}?tenant_id=`: a module reads its own settings for the
tenant it serves, signed with its service identity (contracts/admin.md, Settings)."""

from __future__ import annotations

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
