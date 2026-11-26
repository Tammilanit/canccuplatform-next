"""`GET /internal/admin/people/with-role?tenant_id=`: the user ids of the event's role holders,
for notify's crew test only (#782 part C, plan Q7, D16; contracts/admin.md, Internal)."""

from __future__ import annotations

import pytest
from conftest import World, owner_and_member
from test_internal_settings import signed

PATH = "/internal/admin/people/with-role"


async def test_the_role_holders_ids_go_to_notify_only(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    await owner_and_member(world, caplog)  # Olli holds the owner role, Aino none
    users = {u.name: (u.id, role) for u, role in await world.store.list_users()}
    r = await world.internal.get(PATH, params={"tenant_id": "demo"}, headers=signed("notify"))
    assert r.status_code == 200
    assert r.json() == {"user_ids": [users["Olli"][0]]}
    assert users["Aino"][1] is None


async def test_another_module_or_an_unsigned_call_is_refused(world: World) -> None:
    query = {"tenant_id": "demo"}
    other = await world.internal.get(PATH, params=query, headers=signed("screen"))
    unsigned = await world.internal.get(PATH, params=query)
    assert (other.status_code, other.json()["error"]["code"]) == (403, "service_forbidden")
    assert unsigned.status_code == 401


async def test_a_bad_tenant_id_is_refused(world: World) -> None:
    r = await world.internal.get(PATH, params={"tenant_id": ""}, headers=signed("notify"))
    assert r.status_code == 400
