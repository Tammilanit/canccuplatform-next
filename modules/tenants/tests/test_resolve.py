"""Host-based resolution, `ask`, and the superadmin's hostnames."""

from __future__ import annotations

import asyncio

from conftest import SUPERADMIN_HOST, Env, make_tenant, make_user


async def test_resolve_gives_the_context_of_an_active_hostname(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.client("tenants:8080") as c:
        ok = await c.get("/internal/tenants/resolve", params={"host": "alpha.example.org"})
        unknown = await c.get("/internal/tenants/resolve", params={"host": "nope.example.org"})
        bad = await c.get("/internal/tenants/resolve", params={"host": "Alpha.example.org:80"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["tenant_id"] == "alpha"
    assert body["primary_hostname"] == "alpha.example.org"
    assert body["venue"]["addresses"] == ["127.0.0.0/8"]
    assert body["venue_ip_check"] == {"enabled": True, "disabled_until": None, "reason": None}
    assert body["flags"] == {"bot.stats": False, "screen.pulse": True}
    assert unknown.status_code == 404
    assert bad.status_code == 400


async def test_unknown_host_gets_nothing_but_health_answers(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.client("other.example.org") as c:
        unknown = await c.get("/api/tenants/current")
        health = await c.get("/health")
    assert unknown.status_code == 404
    assert unknown.json() == {"error": {"code": "not_found", "message": "Not found."}}
    assert health.status_code == 200


async def test_ask_allows_only_active_hostnames(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.db.platform() as conn:
        await conn.execute(
            "INSERT INTO hostnames (hostname, tenant_id, kind, status)"
            " VALUES ('pending.example.org', 'alpha', 'custom', 'pending')"
        )
    async with env.client("tenants:8080") as c:
        active = await c.get("/internal/tenants/ask", params={"domain": "alpha.example.org"})
        pending = await c.get("/internal/tenants/ask", params={"domain": "pending.example.org"})
        unknown = await c.get("/internal/tenants/ask", params={"domain": "x.example.org"})
    assert (active.status_code, pending.status_code, unknown.status_code) == (200, 404, 404)


async def _superadmin(env: Env) -> dict[str, str]:
    async with env.db.platform() as conn:
        await make_user(conn, "u_super", superadmin=True)
    return env.rights.sign_in("u_super")


async def test_superadmin_paths_are_404_off_the_superadmin_host(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    cookie = await _superadmin(env)
    async with env.client("alpha.example.org") as c:
        r = await c.get("/api/tenants/registry", headers=cookie)
    assert r.status_code == 404


async def test_superadmin_needs_two_factor(env: Env) -> None:
    async with env.db.platform() as conn:
        await make_user(conn, "u_nomfa", superadmin=True, mfa=False)
        await make_user(conn, "u_plain")
    async with env.client(SUPERADMIN_HOST) as c:
        guest = await c.get("/api/tenants/registry")
        no_mfa = await c.get("/api/tenants/registry", headers=env.rights.sign_in("u_nomfa"))
        plain = await c.get("/api/tenants/registry", headers=env.rights.sign_in("u_plain"))
    assert guest.status_code == 401
    assert no_mfa.json()["error"]["code"] == "mfa_required"
    assert plain.json()["error"]["code"] == "superadmin_required"


async def test_hostname_lifecycle(env: Env) -> None:
    cookie = await _superadmin(env)
    async with env.client(SUPERADMIN_HOST) as c:
        created = await c.post(
            "/api/tenants/registry",
            json={"id": "alpha", "name": "Alpha", "time_zone": "Europe/Helsinki"},
            headers=cookie,
        )
        assert created.status_code == 201, created.text
        assert created.json()["status"] == "draft"
        await make_tenant(env.db, "beta", "beta.example.org")
        url = "/api/tenants/registry/alpha/hostnames"
        platform = await c.post(url, json={"hostname": "alpha.example.test"}, headers=cookie)
        assert platform.json()["status"] == "active"
        assert platform.json()["primary"] is True
        custom = await c.post(url, json={"hostname": "lan.example.org"}, headers=cookie)
        assert custom.json()["status"] == "pending"
        token = custom.json()["verification"]["txt_value"]
        failed = await c.post("/api/tenants/hostnames/lan.example.org/verify", headers=cookie)
        assert failed.json()["error"]["code"] == "verification_failed"
        env.txt["_canccu-verify.lan.example.org"] = [token]
        verified = await c.post("/api/tenants/hostnames/lan.example.org/verify", headers=cookie)
        assert verified.json()["status"] == "active"
        reserved = await c.post(url, json={"hostname": SUPERADMIN_HOST}, headers=cookie)
        assert reserved.json()["error"]["code"] == "hostname_reserved"
        taken = await c.post(url, json={"hostname": "beta.example.org"}, headers=cookie)
        assert taken.json()["error"]["code"] == "hostname_taken"
        removed = await c.delete("/api/tenants/hostnames/alpha.example.test", headers=cookie)
        assert removed.status_code == 204
        held = await c.post(
            "/api/tenants/registry/beta/hostnames",
            json={"hostname": "alpha.example.test"},
            headers=cookie,
        )
        assert held.json()["error"]["code"] == "hostname_held"
        listed = await c.get(url, headers=cookie)
        again = await c.post(
            "/api/tenants/registry",
            json={"id": "alpha", "name": "A", "time_zone": "UTC"},
            headers=cookie,
        )
    by_name = {h["hostname"]: h for h in listed.json()["hostnames"]}
    assert by_name["alpha.example.test"]["status"] == "held"
    assert by_name["lan.example.org"]["primary"] is True  # took over from the removed primary
    assert again.json()["error"]["code"] == "tenant_exists"
    assert ("events:tenants", "tenants.tenant.created") in env.events()
    assert ("events:tenants", "tenants.hostname.changed") in env.events()


async def _new_tenant(c: object, cookie: dict[str, str], tid: str = "alpha") -> None:
    r = await c.post(  # type: ignore[attr-defined]
        "/api/tenants/registry",
        json={"id": tid, "name": tid, "time_zone": "UTC"},
        headers=cookie,
    )
    assert r.status_code == 201, r.text


async def test_a_pending_hostname_never_becomes_primary(env: Env) -> None:
    cookie = await _superadmin(env)
    url = "/api/tenants/registry/alpha/hostnames"
    async with env.client(SUPERADMIN_HOST) as c:
        await _new_tenant(c, cookie)
        pending = await c.post(url, json={"hostname": "x.example.org"}, headers=cookie)
        active = await c.post(url, json={"hostname": "y.example.test"}, headers=cookie)
        refused = await c.patch(
            "/api/tenants/hostnames/x.example.org", json={"primary": True}, headers=cookie
        )
        tenant = (await c.get("/api/tenants/registry/alpha", headers=cookie)).json()
    assert pending.json()["primary"] is False
    assert active.json()["primary"] is True
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "hostname_not_active"
    assert tenant["primary_hostname"] == "y.example.test"


async def test_a_verified_hostname_becomes_primary_when_none_is_active(env: Env) -> None:
    cookie = await _superadmin(env)
    async with env.client(SUPERADMIN_HOST) as c:
        await _new_tenant(c, cookie)
        added = await c.post(
            "/api/tenants/registry/alpha/hostnames",
            json={"hostname": "x.example.org"},
            headers=cookie,
        )
        env.txt["_canccu-verify.x.example.org"] = [added.json()["verification"]["txt_value"]]
        verified = await c.post("/api/tenants/hostnames/x.example.org/verify", headers=cookie)
        tenant = (await c.get("/api/tenants/registry/alpha", headers=cookie)).json()
    assert verified.json()["primary"] is True
    assert tenant["primary_hostname"] == "x.example.org"


async def test_concurrent_adds_give_one_primary_and_never_overwrite(env: Env) -> None:
    cookie = await _superadmin(env)
    url = "/api/tenants/registry/alpha/hostnames"
    async with env.client(SUPERADMIN_HOST) as c:
        await _new_tenant(c, cookie)
        different = await asyncio.gather(
            *(
                c.post(url, json={"hostname": f"n{i}.example.test"}, headers=cookie)
                for i in range(4)
            )
        )
        same = await asyncio.gather(
            *(c.post(url, json={"hostname": "same.example.org"}, headers=cookie) for _ in range(4))
        )
        listed = (await c.get(url, headers=cookie)).json()["hostnames"]
    assert [r.status_code for r in different] == [201] * 4
    assert sorted(r.status_code for r in same) == [201, 409, 409, 409]
    tokens = {r.json()["verification"]["txt_value"] for r in same if r.status_code == 201}
    by_name = {h["hostname"]: h for h in listed}
    assert by_name["same.example.org"]["verification"]["txt_value"] in tokens
    assert sum(h["primary"] for h in listed) == 1


async def test_create_refuses_an_end_before_the_start(env: Env) -> None:
    cookie = await _superadmin(env)
    async with env.client(SUPERADMIN_HOST) as c:
        r = await c.post(
            "/api/tenants/registry",
            json={
                "id": "alpha",
                "name": "A",
                "time_zone": "UTC",
                "starts_at": "2026-06-02T10:00:00Z",
                "ends_at": "2026-06-01T10:00:00Z",
            },
            headers=cookie,
        )
    assert r.status_code == 400


async def test_ip_mode_serves_the_demo_tenant_on_an_ip_host(env: Env) -> None:
    from pathlib import Path

    from canccu_kit import Health

    from canccu_tenants import seed
    from canccu_tenants.app import create_app

    await seed.seed_demo(env.db, env.deps.files, Path("/nonexistent/profile.yaml"), None)
    app = create_app(env.deps, Health("tenants", "dev", {}), [], "dev", ip_mode=True)
    env.app = app
    async with env.client("127.0.0.1") as c:
        r = await c.get("/api/tenants/current")
    assert r.json()["id"] == "demo"
