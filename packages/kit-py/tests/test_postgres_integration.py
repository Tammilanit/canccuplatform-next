"""RLS against a real Postgres.

Runs only when CANCCU_DATABASE_URL is set; see README, Integration test. The URL's role must be
able to create roles and tables; the tests then run as a plain app role, because a superuser
bypasses RLS. Role and table names differ from the kit-ts test so both can share one database.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import pytest

from canccu_kit.db import (
    TENANT_COLUMN_SQL,
    RlsBypassed,
    check_app_role,
    rls_sql,
    run_migrations,
    tenant_transaction,
)

URL = os.environ.get("CANCCU_DATABASE_URL", "")
APP_ROLE = "canccu_kit_test_app_py"

pytestmark = pytest.mark.skipif(not URL, reason="CANCCU_DATABASE_URL is not set")


@pytest.fixture
async def conn() -> AsyncIterator[asyncpg.Connection]:
    c = await asyncpg.connect(URL)
    await c.execute(f"""
        DROP TABLE IF EXISTS kit_py_test_items, kit_py_test_lists;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
            CREATE ROLE {APP_ROLE} NOLOGIN;
          END IF;
        END $$;
        CREATE TABLE kit_py_test_lists (
          {TENANT_COLUMN_SQL},
          id text NOT NULL,
          PRIMARY KEY (tenant_id, id)
        );
        CREATE TABLE kit_py_test_items (
          {TENANT_COLUMN_SQL},
          id text NOT NULL,
          list_id text NOT NULL,
          PRIMARY KEY (tenant_id, id),
          FOREIGN KEY (tenant_id, list_id) REFERENCES kit_py_test_lists (tenant_id, id)
        );
        {rls_sql("kit_py_test_lists")}
        {rls_sql("kit_py_test_items")}
        GRANT SELECT, INSERT, UPDATE, DELETE ON kit_py_test_lists, kit_py_test_items TO {APP_ROLE};
    """)
    await c.execute(f"SET ROLE {APP_ROLE}")
    for tenant in ["leak-a", "leak-b"]:
        async with tenant_transaction(c, tenant):
            await c.execute("INSERT INTO kit_py_test_lists (id) VALUES ('shared-id')")
    try:
        yield c
    finally:
        await c.execute("RESET ROLE")
        await c.execute("DROP TABLE IF EXISTS kit_py_test_items, kit_py_test_lists")
        await c.close()


async def list_tenants(conn: asyncpg.Connection, tenant: str) -> list[str]:
    async with tenant_transaction(conn, tenant):
        rows = await conn.fetch("SELECT tenant_id FROM kit_py_test_lists")
    return [row["tenant_id"] for row in rows]


async def test_each_tenant_sees_only_its_own_rows_filled_by_the_column_default(
    conn: asyncpg.Connection,
) -> None:
    assert await list_tenants(conn, "leak-a") == ["leak-a"]
    assert await list_tenants(conn, "leak-b") == ["leak-b"]


async def test_nothing_is_visible_with_no_tenant_also_right_after_a_tenant_transaction(
    conn: asyncpg.Connection,
) -> None:
    assert await conn.fetch("SELECT * FROM kit_py_test_lists") == []
    await list_tenants(conn, "leak-a")
    assert await conn.fetch("SELECT * FROM kit_py_test_lists") == []


async def test_an_insert_with_no_tenant_set_fails(conn: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.PostgresError, match=r"null value|violates"):
        await conn.execute("INSERT INTO kit_py_test_lists (id) VALUES ('x')")


async def test_writing_a_row_for_another_tenant_fails(conn: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.PostgresError, match="row-level security"):
        async with tenant_transaction(conn, "leak-a"):
            await conn.execute(
                "INSERT INTO kit_py_test_lists (tenant_id, id) VALUES ('leak-b', 'y')"
            )


async def test_the_composite_foreign_key_refuses_another_tenants_row(
    conn: asyncpg.Connection,
) -> None:
    async with tenant_transaction(conn, "leak-b"):
        await conn.execute("INSERT INTO kit_py_test_lists (id) VALUES ('only-in-b')")
    with pytest.raises(asyncpg.PostgresError, match="foreign key"):
        async with tenant_transaction(conn, "leak-a"):
            await conn.execute(
                "INSERT INTO kit_py_test_items (id, list_id) VALUES ('i', 'only-in-b')"
            )
    async with tenant_transaction(conn, "leak-a"):
        await conn.execute("INSERT INTO kit_py_test_items (id, list_id) VALUES ('i', 'shared-id')")


async def test_check_app_role_accepts_the_app_role_and_refuses_the_superuser(
    conn: asyncpg.Connection,
) -> None:
    await check_app_role(conn)
    await conn.execute("RESET ROLE")
    try:
        with pytest.raises(RlsBypassed):
            await check_app_role(conn)
    finally:
        await conn.execute(f"SET ROLE {APP_ROLE}")


async def test_works_through_a_pooled_connection_and_refuses_nesting_on_it(
    conn: asyncpg.Connection,
) -> None:
    # asyncpg hands out PoolConnectionProxy objects, not Connections; they cannot be
    # weak-referenced, so this is the path modules really take.
    pool = await asyncpg.create_pool(URL, min_size=1, max_size=1)
    try:
        async with pool.acquire() as pooled:
            await pooled.execute(f"SET ROLE {APP_ROLE}")
            try:
                async with tenant_transaction(pooled, "leak-a"):
                    rows = await pooled.fetch("SELECT tenant_id FROM kit_py_test_lists")
                assert [row["tenant_id"] for row in rows] == ["leak-a"]
                with pytest.raises(RuntimeError, match="already"):
                    async with (
                        tenant_transaction(pooled, "leak-a"),
                        tenant_transaction(pooled, "leak-b"),
                    ):
                        pass
                # The refused nesting left nothing open: the connection is usable again.
                async with tenant_transaction(pooled, "leak-b"):
                    rows = await pooled.fetch("SELECT tenant_id FROM kit_py_test_lists")
                assert [row["tenant_id"] for row in rows] == ["leak-b"]
            finally:
                await pooled.execute("RESET ROLE")
    finally:
        await pool.close()


async def test_refuses_to_start_inside_a_plain_transaction(conn: asyncpg.Connection) -> None:
    async with conn.transaction():
        with pytest.raises(RuntimeError, match="already in a transaction"):
            async with tenant_transaction(conn, "leak-a"):
                pass


async def wait_for_lock_wait(watcher: asyncpg.Connection, pid: int) -> None:
    for _ in range(200):
        state = await watcher.fetchval(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", pid
        )
        if state == "Lock":
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"backend {pid} never waited on a lock")


async def test_migrations_of_two_modules_started_at_once_run_one_after_the_other(
    tmp_path: Path,
) -> None:
    # Different modules, so different module locks: only the platform lock keeps them apart.
    gate_key = 0x6B_17_28_4A
    first_dir, second_dir = tmp_path / "first", tmp_path / "second"
    first_dir.mkdir()
    second_dir.mkdir()
    # The first module's file waits on a lock the test holds, so it is mid-run when the second
    # module starts.
    (first_dir / "001.sql").write_text(
        f"SELECT pg_advisory_xact_lock({gate_key}); CREATE TABLE kit_py_mig_first ();"
    )
    (second_dir / "001.sql").write_text("CREATE TABLE kit_py_mig_second ();")
    gate, first, second = [await asyncpg.connect(URL) for _ in range(3)]
    tables = "kit_py_mig_first, kit_py_mig_second, kit_py_mig_first_m, kit_py_mig_second_m"
    await gate.execute(f"DROP TABLE IF EXISTS {tables}")
    runs: list[asyncio.Task[None]] = []
    try:
        await gate.execute("SELECT pg_advisory_lock($1)", gate_key)
        first_run = asyncio.create_task(
            run_migrations(first, first_dir, ledger="kit_py_mig_first_m", lock=0x6B_17_28_01)
        )
        runs.append(first_run)
        await wait_for_lock_wait(gate, first.get_server_pid())
        second_run = asyncio.create_task(
            run_migrations(second, second_dir, ledger="kit_py_mig_second_m", lock=0x6B_17_28_02)
        )
        runs.append(second_run)
        await wait_for_lock_wait(gate, second.get_server_pid())
        assert not second_run.done()
        assert await gate.fetchval("SELECT to_regclass('kit_py_mig_second')") is None

        await gate.execute("SELECT pg_advisory_unlock($1)", gate_key)
        await asyncio.wait_for(asyncio.gather(first_run, second_run), 10)
        assert await gate.fetchval("SELECT to_regclass('kit_py_mig_second')") is not None
    finally:
        # Let a still waiting run finish before the DROP, or the DROP waits on it in turn.
        await gate.execute("SELECT pg_advisory_unlock_all()")
        await asyncio.wait_for(asyncio.gather(*runs, return_exceptions=True), 10)
        await gate.execute(f"DROP TABLE IF EXISTS {tables}")
        for c in (gate, first, second):
            await c.close()
