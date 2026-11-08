"""Cross-tenant leak tests (0013 item 8): every per-tenant table and every `current` read."""

from __future__ import annotations

from typing import Any

import pytest
from canccu_kit.testing import assert_tenant_isolation
from conftest import Env, make_tenant

from canccu_tenants.db import Db

HOSTS = {"leak-a": "a.example.org", "leak-b": "b.example.org"}


@pytest.fixture
async def two(env: Env) -> Env:
    for tid, host in HOSTS.items():
        await make_tenant(env.db, tid, host, admins=(f"u_{tid}",))
    return env


class HttpProbe:
    """Seeds through the API as the tenant's admin, reads on the tenant's hostname."""

    def __init__(self, env: Env, read_path: str) -> None:
        self.env, self.read_path = env, read_path

    async def seed(self, tenant: str, marker: str) -> None:
        async with self.env.client(HOSTS[tenant]) as c:
            admin = self.env.rights.sign_in(f"u_{tenant}")
            r = await c.put(
                "/api/tenants/current/venue-info",
                headers=admin,
                json={"revision": 0, "house_rules": marker, "wifi": []},
            )
            assert r.status_code == 200, r.text

    async def read(self, tenant: str) -> object:
        async with self.env.client(HOSTS[tenant]) as c:
            admin = self.env.rights.sign_in(f"u_{tenant}")
            return (await c.get(self.read_path, headers=admin)).json()


class AuditProbe(HttpProbe):
    """Seeds as another module would, through the internal append."""

    async def seed(self, tenant: str, marker: str) -> None:
        async with self.env.module("screen") as c:
            r = await c.post(
                "/internal/tenants/audit",
                json={
                    "tenant_id": tenant,
                    "module": "screen",
                    "action": "screen.device.moved",
                    "target": {"type": "device", "id": "d1"},
                    "reason": marker,
                },
            )
            assert r.status_code == 201, r.text


async def test_venue_info_reads_stay_in_their_tenant(two: Env) -> None:
    probe = HttpProbe(two, "/api/tenants/current/venue-info")
    await assert_tenant_isolation(probe, tuple(HOSTS))  # type: ignore[arg-type]


async def test_audit_reads_stay_in_their_tenant(two: Env) -> None:
    probe = AuditProbe(two, "/api/tenants/current/audit")
    await assert_tenant_isolation(probe, tuple(HOSTS))  # type: ignore[arg-type]


class TableProbe:
    """Writes and reads one per-tenant table as the app role, so RLS alone must keep them apart."""

    def __init__(self, db: Db, insert: str, select: str) -> None:
        self.db, self.insert, self.select = db, insert, select

    async def seed(self, tenant: str, marker: str) -> None:
        async with self.db.tenant(tenant) as conn:
            await conn.execute(self.insert, marker)

    async def read(self, tenant: str) -> Any:
        async with self.db.tenant(tenant) as conn:
            return [dict(r) for r in await conn.fetch(self.select)]


TABLES = {
    "event_admins": (
        "INSERT INTO users (id, discord_id, name, audit_ref) VALUES ($1, $1, $1, $1);"
        " INSERT INTO event_admins (user_id) VALUES ($1)",
        "SELECT user_id FROM event_admins",
    ),
    "tenant_flags": (
        "INSERT INTO tenant_flags (name, value) VALUES ($1, true)",
        "SELECT name FROM tenant_flags",
    ),
    "venue_info": (
        "INSERT INTO venue_info (house_rules) VALUES ($1)"
        " ON CONFLICT (tenant_id) DO UPDATE SET house_rules = $1",
        "SELECT house_rules FROM venue_info",
    ),
    "audit": (
        "INSERT INTO audit (id, actor, action, target) VALUES ($1, '{}', 'a.b.c', '{}')",
        "SELECT id FROM audit",
    ),
}


@pytest.mark.parametrize("table", sorted(TABLES))
async def test_rls_keeps_each_table_apart(two: Env, table: str) -> None:
    insert, select = TABLES[table]
    if ";" in insert:  # asyncpg runs one statement per call with arguments
        first, second = insert.split(";")

        class Two(TableProbe):
            async def seed(self, tenant: str, marker: str) -> None:
                async with self.db.tenant(tenant) as conn:
                    await conn.execute(first, marker)
                    await conn.execute(second, marker)

        probe: TableProbe = Two(two.db, insert, select)
    else:
        probe = TableProbe(two.db, insert, select)
    await assert_tenant_isolation(probe, tuple(HOSTS))  # type: ignore[arg-type]


async def test_no_tenant_set_sees_no_tenant_rows(two: Env) -> None:
    async with two.db.platform() as conn:
        assert await conn.fetch("SELECT * FROM event_admins") == []
        assert await conn.fetch("SELECT * FROM venue_info") == []
