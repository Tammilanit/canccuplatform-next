"""`screen_access` (contracts/tenants.md, Screen access; #783): pairing is the trust, so a paired
screen plays from anywhere by default (`internet`); `restricted` brings back the venue IP check."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
from canccu_kit import DEMO_TENANT
from canccu_kit.access import VenueIpRefused, check_screen_access
from conftest import Env, make_tenant

from canccu_tenants.core import Files
from canccu_tenants.seed import seed_demo

HOST = "alpha.example.org"
PROFILE = Path(__file__).parents[3] / "events/demo/profile.yaml"
ELSEWHERE = "198.51.100.7"


async def resolve(env: Env) -> httpx.Response:
    """The tenant context as the kit reads it."""
    async with env.module("screen") as c:
        return await c.get("/internal/tenants/resolve", params={"host": HOST})


async def test_a_new_event_lets_paired_screens_play_from_anywhere(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        read = await c.get("/api/tenants/current", headers=admin)
    ctx = await resolve(env)
    assert read.json()["screen_access"] == "internet"
    assert ctx.json()["screen_access"] == "internet"
    check_screen_access(ctx.json(), device_token_valid=True, client_ip=ELSEWHERE)


async def test_an_event_admin_turns_the_venue_check_on_and_off_audited(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        on = await c.patch(
            "/api/tenants/current",
            json={"revision": 1, "screen_access": "restricted"},
            headers=admin,
        )
        ctx = await resolve(env)
        bad = await c.patch(
            "/api/tenants/current",
            json={"revision": 2, "screen_access": "venue"},
            headers=admin,
        )
        off = await c.patch(
            "/api/tenants/current",
            json={"revision": 2, "screen_access": "internet"},
            headers=admin,
        )
    assert on.json()["screen_access"] == "restricted"
    assert ctx.json()["screen_access"] == "restricted"
    try:
        check_screen_access(ctx.json(), device_token_valid=True, client_ip=ELSEWHERE)
        raise AssertionError("a restricted event must refuse a screen away from the venue")
    except VenueIpRefused:
        pass
    assert bad.status_code == 400
    assert off.json()["screen_access"] == "internet"
    async with env.db.tenant("alpha") as conn:
        changes = await conn.fetch(
            "SELECT changes FROM audit WHERE action = 'tenants.tenant.changed' ORDER BY time, id"
        )
    assert [json.loads(r["changes"]) for r in changes] == [
        {"screen_access": {"old": "internet", "new": "restricted"}},
        {"screen_access": {"old": "restricted", "new": "internet"}},
    ]


async def test_only_the_event_admin_role_changes_it(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    crew = env.rights.sign_in("u_crew", "tenants.event.write")
    async with env.client(HOST) as c:
        refused = await c.patch(
            "/api/tenants/current",
            json={"revision": 1, "screen_access": "restricted"},
            headers=crew,
        )
    assert refused.status_code == 403


async def test_the_demo_event_lets_screens_play_from_anywhere(env: Env, tmp_path: Path) -> None:
    assert await seed_demo(env.db, Files(str(tmp_path)), PROFILE, None)
    async with env.db.tenant(DEMO_TENANT) as conn:
        value = await conn.fetchval("SELECT screen_access FROM tenants WHERE id = $1", DEMO_TENANT)
    assert value == "internet"
