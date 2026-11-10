"""The storage quota over time (contracts/tenants.md, Storage quota): the repair path and the
superadmin's quota setting."""

from __future__ import annotations

import json
from typing import Any

import httpx
from conftest import SUPERADMIN_HOST, Env, make_tenant, sign_in_superadmin

GIB2 = 2_147_483_648


async def repair(c: httpx.AsyncClient, tid: str, module: str, body: Any) -> httpx.Response:
    return await c.put(
        f"/internal/tenants/storage/modules/{module}", params={"tenant_id": tid}, json=body
    )


async def test_repair_sets_the_modules_count_whatever_the_quota(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.db.platform() as conn:
        await conn.execute("UPDATE tenants SET storage_quota_bytes = 100 WHERE id = 'alpha'")
    async with env.module("screen") as c, env.module("theming") as t:
        await t.post(
            "/internal/tenants/storage/reserve",
            params={"tenant_id": "alpha"},
            json={"module": "theming", "bytes": 40},
        )
        first = await repair(c, "alpha", "screen", {"bytes": 500})
        lower = await repair(c, "alpha", "screen", {"bytes": 7})
        zero = await repair(c, "alpha", "screen", {"bytes": 0})
    assert first.status_code == 200
    assert first.json() == {
        "quota_bytes": 100,
        "used_bytes": 540,
        "modules": {"screen": 500, "theming": 40},
    }
    assert lower.json()["modules"] == {"screen": 7, "theming": 40}
    assert zero.json() == {"quota_bytes": 100, "used_bytes": 40, "modules": {"theming": 40}}


async def test_repair_works_in_every_status(env: Env) -> None:
    await make_tenant(env.db, "old", "old.example.org", status="archived")
    async with env.module("screen") as c:
        r = await repair(c, "old", "screen", {"bytes": 12})
    assert r.status_code == 200
    assert r.json()["used_bytes"] == 12


async def test_repair_refuses_bad_input_other_modules_and_unknown_events(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.module("screen") as c, env.client("tenants:8080") as unsigned:
        bad = [
            await repair(c, "alpha", "screen", body)
            for body in ({}, {"bytes": -1}, {"bytes": True}, {"bytes": 1.5}, {"bytes": 2**41})
        ]
        extra = await repair(c, "alpha", "screen", {"bytes": 1, "module": "screen"})
        bad_name = await repair(c, "alpha", "Screen", {"bytes": 1})
        other = await repair(c, "alpha", "theming", {"bytes": 0})
        unknown = await repair(c, "nope", "screen", {"bytes": 1})
        no_identity = await repair(unsigned, "alpha", "screen", {"bytes": 1})
    assert [r.status_code for r in bad] == [400] * 5
    assert (extra.status_code, bad_name.status_code) == (400, 400)
    assert other.status_code == 403
    assert other.json()["error"]["code"] == "service_forbidden"
    assert unknown.status_code == 404
    assert no_identity.status_code in (401, 403)


async def _tenant_changed(env: Env) -> list[dict[str, Any]]:
    return [
        json.loads(v)["data"]
        for call in env.store.calls
        for v in call.fields.values()
        if json.loads(v)["type"] == "tenants.tenant.changed"
    ]


async def test_the_superadmin_sets_the_quota_at_creation_and_later(env: Env) -> None:
    cookie = await sign_in_superadmin(env)
    async with env.client(SUPERADMIN_HOST) as c:
        default = await c.post(
            "/api/tenants/registry",
            json={"id": "plain", "name": "p", "time_zone": "UTC"},
            headers=cookie,
        )
        made = await c.post(
            "/api/tenants/registry",
            json={"id": "alpha", "name": "a", "time_zone": "UTC", "storage_quota_bytes": 5000},
            headers=cookie,
        )
        bad = await c.post(
            "/api/tenants/registry",
            json={"id": "beta", "name": "b", "time_zone": "UTC", "storage_quota_bytes": -1},
            headers=cookie,
        )
        patched = await c.patch(
            "/api/tenants/registry/alpha",
            json={"revision": made.json()["revision"], "storage_quota_bytes": 0},
            headers=cookie,
        )
        too_big = await c.patch(
            "/api/tenants/registry/alpha",
            json={"revision": patched.json()["revision"], "storage_quota_bytes": 2**41},
            headers=cookie,
        )
    assert default.json()["storage_quota_bytes"] == GIB2
    assert made.status_code == 201
    assert made.json()["storage_quota_bytes"] == 5000
    assert bad.status_code == 400
    assert patched.status_code == 200
    assert patched.json()["storage_quota_bytes"] == 0
    assert too_big.status_code == 400
    assert {"changed": ["storage_quota_bytes"], "revision": patched.json()["revision"]}.items() <= (
        (await _tenant_changed(env))[-1].items()
    )
    async with env.db.tenant("alpha") as conn:
        entry = await conn.fetchval(
            "SELECT changes FROM audit WHERE action = 'tenants.tenant.changed'"
        )
    assert json.loads(entry) == {"storage_quota_bytes": {"old": 5000, "new": 0}}


async def test_event_admins_never_set_the_quota(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org", admins=("u_admin",))
    async with env.client("alpha.example.org") as c:
        r = await c.patch(
            "/api/tenants/current",
            json={"revision": 1, "storage_quota_bytes": 1},
            headers=env.rights.sign_in("u_admin"),
        )
    assert r.status_code == 400
