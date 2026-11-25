"""`admin_access` (contracts/tenants.md, Admin access; #778): `internet` by default, `restricted` as
an organiser's choice, and the migration that moves the events that never chose to the default."""

from __future__ import annotations

import json
from pathlib import Path

from conftest import Env, make_tenant

from canccu_tenants.seed import DEMO_TENANT, seed_demo

HOST = "alpha.example.org"
MIGRATION = Path(__file__).parents[1] / "migrations/003_admin_access_internet.sql"
PROFILE = Path(__file__).parents[3] / "events/demo/profile.yaml"


async def away_from_the_venue(env: Env) -> None:
    """The test client (127.0.0.1) is no longer at the event's venue, nor on Tailscale."""
    async with env.db.platform() as conn:
        await conn.execute("UPDATE venues SET addresses = '{192.0.2.0/24}'")


async def test_a_new_event_opens_its_organiser_pages_from_anywhere(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    await away_from_the_venue(env)
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        read = await c.get("/api/tenants/current", headers=admin)
        named = await c.patch(
            "/api/tenants/current", json={"revision": 1, "name": "Renamed"}, headers=admin
        )
    assert read.json()["admin_access"] == "internet"
    assert named.status_code == 200 and named.json()["name"] == "Renamed"


async def test_restricted_refuses_away_from_the_venue_and_internet_lets_in_again(
    env: Env,
) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        on = await c.patch(
            "/api/tenants/current", json={"revision": 1, "admin_access": "restricted"}, headers=admin
        )
        at_venue = await c.get("/api/tenants/current/storage", headers=admin)
        await away_from_the_venue(env)
        away = await c.get("/api/tenants/current/storage", headers=admin)
        back = await c.patch(
            "/api/tenants/current", json={"revision": 2, "admin_access": "internet"}, headers=admin
        )
    assert on.json()["admin_access"] == "restricted"
    assert at_venue.status_code == 200
    assert away.json()["error"]["code"] == "admin_access_restricted"
    # Turning it off again needs the venue too: from away it is refused like any right.
    assert back.json()["error"]["code"] == "admin_access_restricted"


async def test_the_demo_event_opens_from_anywhere(env: Env, tmp_path: Path) -> None:
    from canccu_tenants.core import Files

    assert await seed_demo(env.db, Files(str(tmp_path)), PROFILE, None)
    async with env.db.tenant(DEMO_TENANT) as conn:
        value = await conn.fetchval("SELECT admin_access FROM tenants WHERE id = $1", DEMO_TENANT)
    assert value == "internet"


async def choose(env: Env, tid: str, value: str) -> None:
    """An organiser's choice as `PATCH` audits it (core.patch_tenant)."""
    async with env.db.tenant(tid) as conn:
        await conn.execute("UPDATE tenants SET admin_access = $2 WHERE id = $1", tid, value)
        await conn.execute(
            "INSERT INTO audit (id, actor, action, target, changes) VALUES"
            " ('a1', '{\"kind\": \"user\"}', 'tenants.tenant.changed', $1, $2)",
            json.dumps({"type": "tenant", "id": tid}),
            json.dumps({"admin_access": {"old": "internet", "new": value}}),
        )


async def test_the_migration_moves_only_events_that_never_chose(env: Env) -> None:
    for tid in ("never", "chose", "open"):
        await make_tenant(env.db, tid, f"{tid}.example.org")
    async with env.db.platform() as conn:
        # As every event stood before the default changed.
        await conn.execute("UPDATE tenants SET admin_access = 'restricted' WHERE id <> 'open'")
        await conn.execute("UPDATE tenants SET admin_access = 'internet' WHERE id = 'open'")
    await choose(env, "chose", "restricted")
    async with env.db.pool.acquire() as conn:
        await conn.execute(MIGRATION.read_text())
    rows = {}
    entries = {}
    for tid in ("never", "chose", "open"):
        async with env.db.tenant(tid) as conn:
            rows[tid] = await conn.fetchrow(
                "SELECT admin_access, revision FROM tenants WHERE id = $1", tid
            )
            entries[tid] = await conn.fetch(
                "SELECT actor, action, changes, reason FROM audit WHERE id <> 'a1'"
            )
    assert dict(rows["never"]) == {"admin_access": "internet", "revision": 2}
    assert dict(rows["chose"]) == {"admin_access": "restricted", "revision": 1}
    assert dict(rows["open"]) == {"admin_access": "internet", "revision": 1}
    # The move is audited like any change of the setting, as the platform's.
    [moved] = entries["never"]
    assert json.loads(moved["actor"])["kind"] == "system"
    assert moved["action"] == "tenants.tenant.changed"
    assert json.loads(moved["changes"]) == {
        "admin_access": {"old": "restricted", "new": "internet"}
    }
    assert "#778" in moved["reason"]
    assert entries["chose"] == [] and entries["open"] == []
