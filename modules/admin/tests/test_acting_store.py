"""The acting-token store: the memory twin and Postgres must behave the same.

The Postgres half runs when CANCCU_DATABASE_URL is set, in a schema of its own that is dropped
afterwards (as tests/test_auth_store.py).
"""

from __future__ import annotations

import os
import secrets
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from canccu_admin.acting_db import ActingStore, ActingToken, MemoryActingStore, PgActingStore
from canccu_admin.auth_db import AuthStore, PgAuthStore
from canccu_admin.auth_memory import MemoryAuthStore
from canccu_admin.db import MIGRATIONS

NOW = datetime(2026, 11, 28, 12, 0, tzinfo=UTC)
URL = os.environ.get("CANCCU_DATABASE_URL")


@pytest.fixture(params=["memory", "postgres"])
async def stores(request: pytest.FixtureRequest) -> AsyncIterator[tuple[AuthStore, ActingStore]]:
    if request.param == "memory":
        auth = MemoryAuthStore()
        yield auth, MemoryActingStore(auth)
        return
    if not URL:
        pytest.skip("CANCCU_DATABASE_URL not set")
    schema = f"test_{secrets.token_hex(6)}"
    admin = await asyncpg.connect(URL)
    await admin.execute(f"CREATE SCHEMA {schema}")
    pool = await asyncpg.create_pool(URL, server_settings={"search_path": schema})
    async with pool.acquire() as conn:
        for path in sorted(MIGRATIONS.glob("*.sql")):
            await conn.execute(path.read_text())
    try:
        yield PgAuthStore(pool), PgActingStore(pool)
    finally:
        await pool.close()
        await admin.execute(f"DROP SCHEMA {schema} CASCADE")
        await admin.close()


async def test_an_account_by_discord_id_or_user_id_with_role_and_removal(
    stores: tuple[AuthStore, ActingStore],
) -> None:
    auth, acting = stores
    olli = await auth.upsert_user("1001", "Olli", NOW)
    await auth.set_role(olli.id, "admin", "u_0", NOW)
    found = await acting.account(discord_id="1001")
    assert found is not None and (found.user.id, found.role, found.removed) == (
        olli.id,
        "admin",
        False,
    )
    assert await acting.account(discord_id="9999") is None
    await auth.remove_user(olli.id, NOW)
    gone = await acting.account(user_id=olli.id)
    assert gone is not None and (gone.role, gone.removed) == (None, True)


async def test_tokens_are_kept_by_hash_and_expired_ones_go(
    stores: tuple[AuthStore, ActingStore],
) -> None:
    auth, acting = stores
    user = await auth.upsert_user("1001", "Olli", NOW)
    old = ActingToken("demo", user.id, "pizza", NOW + timedelta(seconds=60))
    await acting.save("h-old", old, NOW)
    assert await acting.get("h-old") == old
    later = NOW + timedelta(seconds=61)
    new = ActingToken("demo", user.id, "moments", later + timedelta(seconds=60))
    await acting.save("h-new", new, later)
    assert await acting.get("h-old") is None
    assert await acting.get("h-new") == new
