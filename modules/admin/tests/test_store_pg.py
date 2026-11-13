"""The settings store against Postgres: row-level security, the migration and the leak test.

Runs when CANCCU_DATABASE_URL is set (deploy/compose.test.yml; CI's `module (admin)` job), as
the login role, which is the Compose superuser: the store must still keep tenants apart, because
each of its transactions switches to the app role that RLS binds.
"""

from __future__ import annotations

import os
import secrets
from collections.abc import AsyncIterator
from urllib.parse import urlsplit

import asyncpg
import pytest
from canccu_kit import NoTenant, tenant_scope
from canccu_kit.testing import assert_tenant_isolation, require_test_database_url
from conftest import StoreProbe

from canccu_admin.db import APP_ROLE, MIGRATIONS, PgStore

URL = os.environ.get("CANCCU_DATABASE_URL")


async def connect_store(url: str) -> PgStore:
    await require_test_database_url(url)  # first: connect runs the migrations, 003 drops tables
    return await PgStore.connect(url)


@pytest.fixture
async def store() -> AsyncIterator[PgStore]:
    if not URL:
        pytest.skip("CANCCU_DATABASE_URL not set")
    store = await connect_store(URL)
    async with store.pool.acquire() as conn:  # the login role: RLS does not bind it
        await conn.execute(
            "TRUNCATE admin_tenant_settings, admin_tenant_profile, admin_tenant_settings_changes"
        )
    yield store
    await store.close()


async def test_refuses_a_kept_database_before_any_migration_runs() -> None:
    if not URL:
        pytest.skip("CANCCU_DATABASE_URL not set")
    name = f"admin_kept_{secrets.token_hex(4)}"
    admin = await asyncpg.connect(URL)
    await admin.execute(f"CREATE DATABASE {name}")
    try:
        kept = urlsplit(URL)._replace(path=f"/{name}").geturl()
        with pytest.raises(RuntimeError, match=f'"{name}"'):
            await connect_store(kept)
        conn = await asyncpg.connect(kept)
        try:
            # 003 drops tables: not even the ledger may exist.
            tables = await conn.fetchval(
                "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
            )
            assert tables == 0
        finally:
            await conn.close()
    finally:
        await admin.execute(f"DROP DATABASE {name}")
        await admin.close()


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


async def test_settings_changes_are_kept_per_tenant(store: PgStore) -> None:
    with tenant_scope("leak-a"):
        await store.record_change("admin", {"language": "fi"}, "u-1")
        await store.record_change("screen", {"progress_bars": False}, "u-1")
        recent = await store.recent_changes(5)
        assert [(c.module, c.changes) for c in recent] == [
            ("screen", {"progress_bars": False}),
            ("admin", {"language": "fi"}),
        ]
        assert set(await store.last_changed()) == {"admin", "screen"}
    with tenant_scope("leak-b"):
        assert await store.recent_changes(5) == [] and await store.last_changed() == {}


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


async def test_migration_drops_the_single_event_tables_once(store: PgStore) -> None:
    """The contract step of 001's expand and contract (0013 item 22), destructive."""
    assert URL is not None
    async with store.pool.acquire() as conn:
        await conn.execute(
            "CREATE TABLE admin_settings"
            " (module text PRIMARY KEY, settings_version integer NOT NULL, values jsonb NOT NULL)"
        )
        await conn.execute("CREATE TABLE admin_profile (id boolean PRIMARY KEY, document jsonb)")
        await conn.execute(
            "DELETE FROM admin_migrations WHERE name = '003_drop_single_event_tables.sql'"
        )
    again = await PgStore.connect(URL)  # a start that finds the file not yet run
    try:
        async with again.pool.acquire() as conn:
            left = await conn.fetchval(
                "SELECT count(*) FROM pg_tables"
                " WHERE tablename IN ('admin_settings', 'admin_profile')"
            )
            runs = await conn.fetchval(
                "SELECT count(*) FROM admin_migrations WHERE name LIKE '00%'"
            )
            assert (left, runs) == (0, len(list(MIGRATIONS.glob("*.sql"))))
    finally:
        await again.close()


async def test_a_load_is_recorded_per_tenant_and_a_plain_write_keeps_it(store: PgStore) -> None:
    with tenant_scope("leak-a"):
        assert await store.profile_loaded() is None
        await store.set_profile({"name": "A"}, loaded_by="u_1")
        loaded = await store.profile_loaded()
        assert loaded is not None and loaded[1] == "u_1"
        await store.set_profile({"name": "A2"})
        assert await store.profile_loaded() == loaded
    with tenant_scope("leak-b"):
        assert await store.profile_loaded() is None
