"""The storage quota (contracts/tenants.md, Storage quota): reserve, release and the read."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest
from conftest import Env, make_tenant

from canccu_tenants import storage

GIB2 = 2_147_483_648


async def set_quota(env: Env, tid: str, quota: int) -> None:
    async with env.db.platform() as conn:
        await conn.execute("UPDATE tenants SET storage_quota_bytes = $2 WHERE id = $1", tid, quota)


async def change(c: httpx.AsyncClient, op: str, tid: str, module: str, size: Any) -> httpx.Response:
    return await c.post(
        f"/internal/tenants/storage/{op}",
        params={"tenant_id": tid},
        json={"module": module, "bytes": size},
    )


async def test_reserve_adds_to_the_modules_count_and_answers_the_usage(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.module("theming") as c, env.module("screen") as screen:
        first = await change(c, "reserve", "alpha", "theming", 300)
        second = await change(screen, "reserve", "alpha", "screen", 200)
        third = await change(c, "reserve", "alpha", "theming", 50)
    assert (first.status_code, second.status_code, third.status_code) == (200, 200, 200)
    assert first.json() == {"quota_bytes": GIB2, "used_bytes": 300, "modules": {"theming": 300}}
    assert third.json() == {
        "quota_bytes": GIB2,
        "used_bytes": 550,
        "modules": {"screen": 200, "theming": 350},
    }


async def test_a_reserve_past_the_quota_is_413_and_adds_nothing(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    await set_quota(env, "alpha", 1000)
    async with env.module("screen") as c:
        fits = await change(c, "reserve", "alpha", "screen", 1000)
        over = await change(c, "reserve", "alpha", "screen", 1)
        after = await change(c, "release", "alpha", "screen", 1)
    assert fits.status_code == 200
    assert over.status_code == 413
    assert over.json()["error"]["code"] == "storage_quota_exceeded"
    # The message names the quota and what is used (contracts, QuotaExceeded).
    assert "1000" in over.json()["error"]["message"]
    assert after.json()["used_bytes"] == 999


async def test_concurrent_reserves_never_pass_the_quota(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    await set_quota(env, "alpha", 1000)
    async with env.module("screen") as c:
        answers = await asyncio.gather(
            *(change(c, "reserve", "alpha", "screen", 100) for _ in range(25))
        )
        usage = await change(c, "release", "alpha", "screen", 1)
    codes = sorted(r.status_code for r in answers)
    assert codes == [200] * 10 + [413] * 15
    assert usage.json()["used_bytes"] == 999


async def test_release_never_goes_below_zero_and_leaves_out_empty_modules(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.module("screen") as c, env.module("theming") as t, env.module("pizza") as p:
        await change(c, "reserve", "alpha", "screen", 100)
        await change(t, "reserve", "alpha", "theming", 10)
        released = await change(c, "release", "alpha", "screen", 500)
        never_held = await change(p, "release", "alpha", "pizza", 5)
    assert released.status_code == 200
    assert released.json() == {"quota_bytes": GIB2, "used_bytes": 10, "modules": {"theming": 10}}
    assert never_held.json()["used_bytes"] == 10


async def test_an_archived_event_refuses_reserves_but_releases(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.module("screen") as c:
        await change(c, "reserve", "alpha", "screen", 100)
        async with env.db.platform() as conn:
            await conn.execute("UPDATE tenants SET status = 'archived' WHERE id = 'alpha'")
        refused = await change(c, "reserve", "alpha", "screen", 1)
        released = await change(c, "release", "alpha", "screen", 40)
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "event_archived"
    assert released.status_code == 200
    assert released.json()["used_bytes"] == 60


async def test_a_draft_event_takes_reserves(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org", status="draft")
    async with env.module("screen") as c:
        r = await change(c, "reserve", "alpha", "screen", 1)
    assert r.status_code == 200


async def test_an_unknown_tenant_is_404(env: Env) -> None:
    async with env.module("screen") as c:
        reserve = await change(c, "reserve", "nobody", "screen", 1)
        release = await change(c, "release", "nobody", "screen", 1)
    assert (reserve.status_code, release.status_code) == (404, 404)


async def test_bad_requests_are_400(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    bodies: list[Any] = [
        {"module": "screen", "bytes": 0},
        {"module": "screen", "bytes": -5},
        {"module": "screen", "bytes": 1_099_511_627_777},
        {"module": "screen", "bytes": True},
        {"module": "screen", "bytes": "10"},
        {"module": "Screen", "bytes": 1},
        {"module": "screen-render", "bytes": 1},
        {"bytes": 1},
        {"module": "screen", "bytes": 1, "tenant_id": "alpha"},
        ["screen", 1],
    ]
    async with env.module("screen") as c:
        answers = [
            await c.post("/internal/tenants/storage/reserve", params={"tenant_id": "alpha"}, json=b)
            for b in bodies
        ]
        no_tenant = await c.post(
            "/internal/tenants/storage/reserve", json={"module": "screen", "bytes": 1}
        )
        bad_tenant = await change(c, "release", "Alpha!", "screen", 1)
    assert [r.status_code for r in answers] == [400] * len(bodies)
    assert (no_tenant.status_code, bad_tenant.status_code) == (400, 400)


async def test_the_storage_paths_need_a_service_identity(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.client("tenants:8080") as c:
        reserve = await change(c, "reserve", "alpha", "screen", 1)
        release = await change(c, "release", "alpha", "screen", 1)
    # On a tenant's hostname too: the internal paths never answer the public side.
    async with env.client("alpha.example.org") as c:
        public = await change(c, "reserve", "alpha", "screen", 1)
    assert (reserve.status_code, release.status_code, public.status_code) == (401, 401, 401)


async def test_members_and_event_admins_read_the_events_usage(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org", admins=("u_admin",))
    await set_quota(env, "alpha", 5000)
    async with env.module("screen") as c:
        await change(c, "reserve", "alpha", "screen", 1200)
    async with env.client("alpha.example.org") as c:
        guest = await c.get("/api/tenants/current/storage")
        nobody = await c.get("/api/tenants/current/storage", headers=env.rights.sign_in("u_x"))
        member = await c.get(
            "/api/tenants/current/storage",
            headers=env.rights.sign_in("u_member", "screen.assets.write"),
        )
        admin = await c.get("/api/tenants/current/storage", headers=env.rights.sign_in("u_admin"))
        tenant = await c.get("/api/tenants/current", headers=env.rights.sign_in("u_admin"))
    assert guest.status_code == 401
    assert guest.json()["error"]["code"] == "not_signed_in"
    assert nobody.status_code == 403
    assert nobody.json()["error"]["code"] == "missing_right"
    usage = {"quota_bytes": 5000, "used_bytes": 1200, "modules": {"screen": 1200}}
    assert (member.status_code, member.json()) == (200, usage)
    assert (admin.status_code, admin.json()) == (200, usage)
    assert tenant.json()["storage_quota_bytes"] == 5000


async def test_a_module_reserves_and_releases_only_in_its_own_name(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.module("screen") as c:
        await change(c, "reserve", "alpha", "screen", 100)
    async with env.module("theming") as c:
        reserve = await change(c, "reserve", "alpha", "screen", 1)
        release = await change(c, "release", "alpha", "screen", 100)
        own = await change(c, "release", "alpha", "theming", 1)
    assert (reserve.status_code, release.status_code) == (403, 403)
    assert reserve.json()["error"]["code"] == "service_forbidden"
    assert release.json()["error"]["code"] == "service_forbidden"
    assert own.json()["modules"] == {"screen": 100}  # the refused release took nothing


async def test_the_shared_storage_map_lets_a_service_count_for_its_owner(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(storage.SHARED_STORAGE, "screen_worker", "screen")
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.module("screen_worker") as c:
        shared = await change(c, "reserve", "alpha", "screen", 10)
        own_name = await change(c, "reserve", "alpha", "screen_worker", 1)
        other = await change(c, "release", "alpha", "theming", 1)
    assert shared.status_code == 200
    assert shared.json()["modules"] == {"screen": 10}
    # Mapped to its owner, the service no longer counts in its own name.
    assert (own_name.status_code, other.status_code) == (403, 403)


async def test_the_usage_read_follows_restricted_admin_access(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org", admins=("u_admin",))
    async with env.db.platform() as conn:
        await conn.execute("UPDATE venues SET addresses = '{192.0.2.0/24}'")
    async with env.client("alpha.example.org") as c:
        admin = await c.get("/api/tenants/current/storage", headers=env.rights.sign_in("u_admin"))
        member = await c.get(
            "/api/tenants/current/storage",
            headers=env.rights.sign_in("u_member", "screen.assets.write"),
        )
    assert (admin.status_code, member.status_code) == (403, 403)
    assert admin.json()["error"]["code"] == "admin_access_restricted"
    assert member.json()["error"]["code"] == "admin_access_restricted"


async def test_the_venue_info_and_the_usage_read_share_one_member_check(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    wifi = [
        {"ssid": "guest", "password": None, "note": None, "visibility": "public"},
        {"ssid": "crew", "password": "secret-pass", "note": None, "visibility": "attendees"},
    ]
    async with env.db.tenant("alpha") as conn:
        await conn.execute("INSERT INTO venue_info (wifi) VALUES ($1)", json.dumps(wifi))
    member = env.rights.sign_in("u_member", "screen.assets.write")
    nobody = env.rights.sign_in("u_x")
    async with env.client("alpha.example.org") as c:
        member_info = await c.get("/api/tenants/current/venue-info", headers=member)
        member_usage = await c.get("/api/tenants/current/storage", headers=member)
        nobody_info = await c.get("/api/tenants/current/venue-info", headers=nobody)
        nobody_usage = await c.get("/api/tenants/current/storage", headers=nobody)
    assert [w["ssid"] for w in member_info.json()["wifi"]] == ["guest", "crew"]
    assert member_usage.status_code == 200
    assert [w["ssid"] for w in nobody_info.json()["wifi"]] == ["guest"]
    assert nobody_usage.status_code == 403
