"""The settings store against Postgres: row-level security, the migration and the leak test.

Runs when CANCCU_DATABASE_URL is set (deploy/compose.test.yml; CI's `integration (kit)` job), as
the login role, which is the Compose superuser: the store must still keep tenants apart, because
each of its transactions switches to the app role that RLS binds.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import asyncpg
import pytest
from canccu_kit import NoTenant, tenant_scope
from canccu_kit.testing import assert_tenant_isolation
from conftest import StoreProbe

from canccu_admin.db import APP_ROLE, PgStore

URL = os.environ.get("CANCCU_DATABASE_URL")


@pytest.fixture
async def store() -> AsyncIterator[PgStore]:
    if not URL:
        pytest.skip("CANCCU_DATABASE_URL not set")
    store = await PgStore.connect(URL)
    async with store.pool.acquire() as conn:  # the login role: RLS does not bind it
        await conn.execute("TRUNCATE admin_tenant_settings, admin_tenant_profile")
    yield store
    await store.close()


async def test_keeps_tenants_apart(store: PgStore) -> None:
    await assert_tenant_isolation(StoreProbe(store))


async def test_settings_version_and_conflict_per_tenant(store: PgStore) -> None:
    for tenant in ("leak-a", "leak-b"):
        with tenant_scope(tenant):
            assert await store.put_settings("admin", 0, {"language": tenant}) == 1
    with tenant_scope("leak-a"):
        with pytest.raises(Exception, match="read again"):
            await store.put_settings("admin", 0, {"language": "x"})
        assert await store.put_settings("admin", 1, {"language": "fi"}) == 2
        assert await store.get_settings("admin") == (2, {"language": "fi"})
    with tenant_scope("leak-b"):
        assert await store.get_settings("admin") == (1, {"language": "leak-b"})


async def test_refuses_work_without_a_tenant(store: PgStore) -> None:
    with pytest.raises(NoTenant):
        await store.get_settings("admin")
    with pytest.raises(NoTenant):
        await store.set_profile({"name": "x"})


async def test_app_role_sees_nothing_and_writes_nothing_without_a_tenant(store: PgStore) -> None:
    with tenant_scope("leak-a"):
        await store.put_settings("admin", 0, {"language": "fi"})
        await store.set_profile({"name": "A"})
    async with store.pool.acquire() as conn, conn.transaction():
        await conn.execute(f"SET LOCAL ROLE {APP_ROLE}")
        assert await conn.fetchval("SELECT count(*) FROM admin_tenant_settings") == 0
        assert await conn.fetchval("SELECT count(*) FROM admin_tenant_profile") == 0
        # RLS's check refuses it before NOT NULL would; either way nothing is written.
        refused = (asyncpg.InsufficientPrivilegeError, asyncpg.NotNullViolationError)
        with pytest.raises(refused):
            await conn.execute("INSERT INTO admin_tenant_profile (document) VALUES ('{}')")


async def test_app_role_cannot_write_into_another_tenant(store: PgStore) -> None:
    async with store.pool.acquire() as conn, conn.transaction():
        await conn.execute(f"SET LOCAL ROLE {APP_ROLE}")
        await conn.execute("SELECT set_config('canccu.tenant', 'leak-a', true)")
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await conn.execute(
                "INSERT INTO admin_tenant_profile (tenant_id, document) VALUES ('leak-b', '{}')"
            )


async def test_migration_runs_once_and_leaves_the_single_event_tables(store: PgStore) -> None:
    """The old tables stay as they were (expand and contract, 0013 item 22)."""
    assert URL is not None
    async with store.pool.acquire() as conn:
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS admin_settings"
            " (module text PRIMARY KEY, settings_version integer NOT NULL, values jsonb NOT NULL)"
        )
        await conn.execute(
            "INSERT INTO admin_settings VALUES ('test56', 3, '{}') ON CONFLICT DO NOTHING"
        )
    again = await PgStore.connect(URL)  # a second start: the ledger skips the file
    try:
        async with again.pool.acquire() as conn:
            runs = await conn.fetchval(
                "SELECT count(*) FROM admin_migrations WHERE name = '001_tenant_settings.sql'"
            )
            old = await conn.fetchval(
                "SELECT settings_version FROM admin_settings WHERE module = 'test56'"
            )
            assert (runs, old) == (1, 3)
            await conn.execute("DELETE FROM admin_settings WHERE module = 'test56'")
    finally:
        await again.close()
