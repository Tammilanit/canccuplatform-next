"""The sign-in store: the memory twin and Postgres must behave the same.

The Postgres half runs when CANCCU_DATABASE_URL is set (deploy/compose.test.yml), in a schema of
its own that is dropped afterwards.
"""

from __future__ import annotations

import asyncio
import os
import secrets
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from canccu_admin.auth_db import AuthStore, Flow, PgAuthStore
from canccu_admin.auth_memory import MemoryAuthStore
from canccu_admin.db import MIGRATIONS

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
URL = os.environ.get("CANCCU_DATABASE_URL")


@pytest.fixture(params=["memory", "postgres"])
async def store(request: pytest.FixtureRequest) -> AsyncIterator[AuthStore]:
    if request.param == "memory":
        yield MemoryAuthStore()
        return
    if not URL:
        pytest.skip("CANCCU_DATABASE_URL not set")
    schema = f"test_{secrets.token_hex(6)}"
    admin = await asyncpg.connect(URL)
    await admin.execute(f"CREATE SCHEMA {schema}")
    pool = await asyncpg.create_pool(URL, server_settings={"search_path": schema})
    async with pool.acquire() as conn:
        # The migration role creates the sign-in tables now (002), not the store.
        for path in sorted(MIGRATIONS.glob("*.sql")):
            await conn.execute(path.read_text())
    try:
        yield PgAuthStore(pool)
    finally:
        await pool.close()
        await admin.execute(f"DROP SCHEMA {schema} CASCADE")
        await admin.close()


async def test_first_run_claim_works_once(store: AuthStore) -> None:
    assert await store.set_first_run_code("h1", NOW)
    assert await store.first_run_matches("h1") and not await store.first_run_matches("h2")
    assert await store.claim_owner("d1", "Olli", "h2", NOW) is None
    owner = await store.claim_owner("d1", "Olli", "h1", NOW)
    assert owner is not None and await store.has_owner()
    assert await store.claim_owner("d2", "Aino", "h1", NOW) is None
    assert not await store.first_run_matches("h1")
    assert not await store.set_first_run_code("h3", NOW)
    assert await store.get_role(owner.id) == (owner, "owner")


async def test_replaced_code_cannot_claim(store: AuthStore) -> None:
    await store.set_first_run_code("h1", NOW)
    await store.set_first_run_code("h2", NOW)
    assert await store.claim_owner("d1", "Olli", "h1", NOW) is None
    assert await store.claim_owner("d1", "Olli", "h2", NOW) is not None


async def test_concurrent_claims_make_one_owner(store: AuthStore) -> None:
    await store.set_first_run_code("h1", NOW)
    results = await asyncio.gather(
        *(store.claim_owner(f"d{i}", f"User {i}", "h1", NOW) for i in range(5))
    )
    assert sum(r is not None for r in results) == 1
    assert [role for _, role in await store.list_users()].count("owner") == 1


async def test_flow_is_single_use_and_expires(store: AuthStore) -> None:
    flow = Flow("n", "v", None, NOW + timedelta(minutes=10))
    await store.save_flow("s1", flow, NOW)
    assert await store.take_flow("s1", NOW) == flow
    assert await store.take_flow("s1", NOW) is None
    await store.save_flow("s2", Flow("n", "v", "c", NOW + timedelta(minutes=10)), NOW)
    assert await store.take_flow("s2", NOW + timedelta(minutes=11)) is None
    await store.save_flow("s3", Flow("n", "v", None, NOW), NOW)
    await store.prune(NOW, NOW)
    assert await store.take_flow("s3", NOW - timedelta(minutes=1)) is None


async def test_flow_keeps_its_return_path(store: AuthStore) -> None:
    flow = Flow("n", "v", None, NOW + timedelta(minutes=10), "/notify/check-in?p=arrival")
    await store.save_flow("s1", flow, NOW)
    assert await store.take_flow("s1", NOW) == flow


async def test_sessions(store: AuthStore) -> None:
    user = await store.upsert_user("d1", "Aino", NOW)
    await store.create_session("a", user.id, NOW, NOW + timedelta(hours=24))
    row = await store.get_session("a")
    assert row is not None and row.user == user and row.role is None
    assert row.last_seen_at == NOW and row.expires_at == NOW + timedelta(hours=24)
    await store.touch_session("a", NOW + timedelta(hours=1))
    row = await store.get_session("a")
    assert row is not None and row.last_seen_at == NOW + timedelta(hours=1)
    await store.create_session("b", user.id, NOW, NOW + timedelta(hours=24))
    await store.prune(NOW + timedelta(hours=2), idle_before=NOW + timedelta(minutes=30))
    assert await store.get_session("a") is not None and await store.get_session("b") is None
    await store.delete_session("a")
    assert await store.get_session("a") is None


async def test_users_and_roles(store: AuthStore) -> None:
    first = await store.upsert_user("d1", "aino", NOW)
    renamed = await store.upsert_user("d1", "Aino", NOW)
    assert renamed.id == first.id and renamed.name == "Aino"
    await store.set_first_run_code("h", NOW)
    owner = await store.claim_owner("d2", "Olli", "h", NOW)
    assert owner is not None
    await store.set_role(first.id, "admin", owner.id, NOW)
    assert await store.list_users() == [(renamed, "admin"), (owner, "owner")]
    await store.set_role(first.id, None, owner.id, NOW)
    assert await store.get_role(first.id) == (renamed, None)
    assert await store.get_role("u_missing") is None


async def test_people_have_a_handle_and_a_last_here(store: AuthStore) -> None:
    """People (#437): the Discord handle beside the name, and when they were last here."""
    aino = await store.upsert_user("d1", "Aino", NOW, handle="aino.k")
    assert aino.handle == "aino.k"
    await store.create_session("a", aino.id, NOW, NOW + timedelta(hours=24))
    await store.touch_session("a", NOW + timedelta(hours=1))
    [person] = await store.people()
    assert person.user == aino and person.role is None
    assert person.last_seen_at == NOW + timedelta(hours=1)


async def test_removing_someone_ends_their_sessions_and_role(store: AuthStore) -> None:
    await store.set_first_run_code("h", NOW)
    owner = await store.claim_owner("d0", "Olli", "h", NOW)
    assert owner is not None
    aino = await store.upsert_user("d1", "Aino", NOW)
    await store.set_role(aino.id, "admin", owner.id, NOW)
    await store.create_session("a", aino.id, NOW, NOW + timedelta(hours=24))
    await store.remove_user(aino.id, NOW)
    assert await store.get_session("a") is None
    assert await store.get_role(aino.id) == (aino, None)
    assert [p.user.name for p in await store.people()] == ["Olli"]
    # Their name stays for the history of what they changed.
    assert aino in [u for u, _ in await store.list_users()]
    # The owner is never removed, and signing in again brings someone back without a role.
    await store.remove_user(owner.id, NOW)
    assert await store.get_role(owner.id) == (owner, "owner")
    await store.upsert_user("d1", "Aino", NOW + timedelta(hours=1))
    assert [(p.user.name, p.role) for p in await store.people()] == [
        ("Aino", None),
        ("Olli", "owner"),
    ]


async def test_a_removed_person_gets_no_role(store: AuthStore) -> None:
    """A grant from a stale People tab after Remove elsewhere must not bring them back as Admin."""
    await store.set_first_run_code("h", NOW)
    owner = await store.claim_owner("d0", "Olli", "h", NOW)
    assert owner is not None
    aino = await store.upsert_user("d1", "Aino", NOW)
    await store.remove_user(aino.id, NOW)
    assert not await store.set_role(aino.id, "admin", owner.id, NOW)
    assert await store.get_role(aino.id) == (aino, None)
    # Signing in again brings them back without a role; then a grant holds.
    await store.upsert_user("d1", "Aino", NOW + timedelta(hours=1))
    assert await store.set_role(aino.id, "admin", owner.id, NOW)
    assert await store.get_role(aino.id) == (aino, "admin")
