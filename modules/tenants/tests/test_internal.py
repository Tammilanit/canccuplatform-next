"""The internal paths: only modules of this stack, each for itself; IP mode for the kit."""

from __future__ import annotations

from conftest import Env, make_tenant


async def test_internal_paths_refuse_callers_without_a_service_identity(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.client("tenants:8080") as c:
        resolve = await c.get("/internal/tenants/resolve", params={"host": "alpha.example.org"})
        audit = await c.post("/internal/tenants/audit", json={})
        # Caddy's on-demand TLS cannot sign; `ask` tells only whether a hostname is active.
        ask = await c.get("/internal/tenants/ask", params={"domain": "alpha.example.org"})
    assert (resolve.status_code, audit.status_code) == (401, 401)
    assert resolve.json()["error"]["code"] == "service_unauthenticated"
    assert ask.status_code == 200


async def test_a_module_appends_audit_entries_only_in_its_own_name(env: Env) -> None:
    await make_tenant(env.db, "alpha", "alpha.example.org")
    entry = {
        "tenant_id": "alpha",
        "module": "screen",
        "action": "screen.device.moved",
        "target": {"type": "device", "id": "d1"},
    }
    async with env.module("bot") as c:
        forged = await c.post("/internal/tenants/audit", json=entry)
    async with env.module("screen") as c:
        own = await c.post("/internal/tenants/audit", json=entry)
    assert forged.status_code == 403
    assert forged.json()["error"]["code"] == "service_forbidden"
    assert own.status_code == 201


async def test_ip_mode_answers_the_demo_tenant_only_while_it_is_the_only_one(env: Env) -> None:
    app = env.app_with(ip_mode=True)
    await make_tenant(env.db, "demo", "demo.example.org")
    async with env.module("admin", app) as c:
        alone = await c.get("/internal/tenants/ip-mode")
    await make_tenant(env.db, "alpha", "alpha.example.org")
    async with env.module("admin", app) as c:
        two = await c.get("/internal/tenants/ip-mode")
    assert alone.status_code == 200
    assert alone.json()["tenant_id"] == "demo"
    assert two.status_code == 404


async def test_ip_mode_is_404_when_the_stack_does_not_run_it(env: Env) -> None:
    await make_tenant(env.db, "demo", "demo.example.org")
    async with env.module("admin") as c:
        off = await c.get("/internal/tenants/ip-mode")
    assert off.status_code == 404


async def test_the_modules_own_ip_literal_requests_use_the_endpoint(env: Env) -> None:
    app = env.app_with(ip_mode=True)
    await make_tenant(env.db, "demo", "demo.example.org")
    async with env.client("192.0.2.1", app) as c:
        current = await c.get("/api/tenants/current")
    assert current.status_code == 200
    assert current.json()["id"] == "demo"
