"""The transactional outbox against a real Postgres (RLS cannot be faked).

Runs only when CANCCU_DATABASE_URL is set, as test_postgres_integration.py. Table and role names
are this test's own, so it shares a database with the others.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import asyncpg
import pytest

from canccu_kit import Bus, Outbox, tenant_transaction
from canccu_kit.db import TENANT_COLUMN_SQL, rls_sql
from canccu_kit.testing import MemoryStreamStore

URL = os.environ.get("CANCCU_DATABASE_URL", "")
APP_ROLE = "canccu_kit_test_outbox_app"

pytestmark = pytest.mark.skipif(not URL, reason="CANCCU_DATABASE_URL is not set")


class FlakyStore(MemoryStreamStore):
    """Refuses the next `failures` xadd calls, as Valkey does while it is down."""

    failures: int = 0

    async def xadd(
        self, stream: str, fields: dict[str, str], *, maxlen: int, approximate: bool
    ) -> str:
        if self.failures:
            self.failures -= 1
            raise ConnectionError("valkey unreachable")
        return await super().xadd(stream, fields, maxlen=maxlen, approximate=approximate)


class Db:
    """The shape of a module's Db: tenant and platform transactions as the app role."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    @asynccontextmanager
    async def tenant(self, tenant_id: str | None = None) -> AsyncIterator[Any]:
        async with self.pool.acquire() as conn, tenant_transaction(conn, tenant_id):
            await conn.execute(f"SET LOCAL ROLE {APP_ROLE}")
            yield conn

    @asynccontextmanager
    async def platform(self) -> AsyncIterator[Any]:
        async with self.pool.acquire() as conn, conn.transaction():
            await conn.execute(f"SET LOCAL ROLE {APP_ROLE}")
            yield conn


@pytest.fixture
async def db() -> AsyncIterator[Db]:
    pool = await asyncpg.create_pool(URL, min_size=1, max_size=4)
    await pool.execute(f"""
        DROP TABLE IF EXISTS kittest_outbox, kittest_outbox_tenants;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
            CREATE ROLE {APP_ROLE} NOLOGIN;
          END IF;
        END $$;
        CREATE TABLE kittest_outbox (
          {TENANT_COLUMN_SQL},
          seq bigint GENERATED ALWAYS AS IDENTITY,
          event text NOT NULL,
          PRIMARY KEY (tenant_id, seq)
        );
        {rls_sql("kittest_outbox")}
        CREATE TABLE kittest_outbox_tenants (tenant_id text PRIMARY KEY);
        GRANT SELECT, INSERT, DELETE ON kittest_outbox TO {APP_ROLE};
        GRANT SELECT, INSERT, UPDATE, DELETE ON kittest_outbox_tenants TO {APP_ROLE};
    """)
    try:
        yield Db(pool)
    finally:
        await pool.execute("DROP TABLE IF EXISTS kittest_outbox, kittest_outbox_tenants")
        await pool.close()


@pytest.fixture
def store() -> FlakyStore:
    return FlakyStore()


@pytest.fixture
def outbox(db: Db, store: FlakyStore) -> Outbox:
    return Outbox(Bus(store, "kittest"), db)


def sent(store: MemoryStreamStore, tenant: str) -> list[dict[str, Any]]:
    entries = store.streams.get(f"t:{tenant}:events:kittest", [])
    return [json.loads(fields["event"]) for _, fields in entries]


async def pending(db: Db) -> tuple[int, list[str]]:
    async with db.pool.acquire() as conn:  # the login role: RLS does not bind it
        rows = await conn.fetchval("SELECT count(*) FROM kittest_outbox")
        tenants = [r[0] for r in await conn.fetch("SELECT tenant_id FROM kittest_outbox_tenants")]
    return rows, tenants


async def test_a_committed_write_sends_its_events_in_order_once(
    db: Db, outbox: Outbox, store: FlakyStore
) -> None:
    async with db.tenant("ev-a") as conn:
        first = await outbox.add(conn, "kittest.thing.made", {"n": 1}, version=1)
        await outbox.add(conn, "kittest.thing.made", {"n": 2}, version=1, correlation_id="c1")
    assert sent(store, "ev-a") == []  # nothing goes out before the flush
    assert await outbox.flush("ev-a") == 2
    events = sent(store, "ev-a")
    assert [e["data"]["n"] for e in events] == [1, 2]
    assert events[0]["id"] == first.id and events[0]["tenant"] == "ev-a"
    assert events[1]["correlation_id"] == "c1"
    assert await outbox.flush("ev-a") == 0
    assert await pending(db) == (0, [])  # an event with nothing pending is forgotten


async def test_a_rolled_back_write_sends_nothing(db: Db, outbox: Outbox, store: FlakyStore) -> None:
    with pytest.raises(RuntimeError):
        async with db.tenant("ev-a") as conn:
            await outbox.add(conn, "kittest.thing.made", {"n": 1}, version=1)
            raise RuntimeError("the write failed")
    assert await outbox.flush("ev-a") == 0
    assert sent(store, "ev-a") == [] and await pending(db) == (0, [])


async def test_a_failed_publish_is_sent_again_later_without_duplicates(
    db: Db, outbox: Outbox, store: FlakyStore
) -> None:
    async with db.tenant("ev-a") as conn:
        for n in (1, 2, 3):
            await outbox.add(conn, "kittest.thing.made", {"n": n}, version=1)
    store.failures = 1
    assert await outbox.flush("ev-a") == 0  # logged, never raised: the write has committed
    assert await pending(db) == (3, ["ev-a"])
    assert await outbox.flush_all() == 3
    assert [e["data"]["n"] for e in sent(store, "ev-a")] == [1, 2, 3]
    assert await pending(db) == (0, [])


async def test_events_sent_before_a_failure_are_not_sent_again(
    db: Db, outbox: Outbox, store: FlakyStore
) -> None:
    async with db.tenant("ev-a") as conn:
        for n in (1, 2):
            await outbox.add(conn, "kittest.thing.made", {"n": n}, version=1)

    real = store.xadd
    calls = 0

    async def second_fails(stream: str, fields: dict[str, str], **kw: Any) -> str:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise ConnectionError("valkey unreachable")
        return await real(stream, fields, **kw)

    store.xadd = second_fails  # type: ignore[method-assign]
    assert await outbox.flush("ev-a") == 1
    assert await outbox.flush("ev-a") == 1
    assert [e["data"]["n"] for e in sent(store, "ev-a")] == [1, 2]


async def test_flush_all_visits_every_event_with_pending_rows(
    db: Db, outbox: Outbox, store: FlakyStore
) -> None:
    for tenant in ("ev-a", "ev-b"):
        async with db.tenant(tenant) as conn:
            await outbox.add(conn, "kittest.thing.made", {"t": tenant}, version=1)
    assert await outbox.flush_all() == 2
    assert [e["data"]["t"] for e in sent(store, "ev-a")] == ["ev-a"]
    assert [e["data"]["t"] for e in sent(store, "ev-b")] == ["ev-b"]


async def test_an_event_of_another_module_is_refused(db: Db, outbox: Outbox) -> None:
    with pytest.raises(ValueError):
        async with db.tenant("ev-a") as conn:
            await outbox.add(conn, "other.thing.made", {}, version=1)
