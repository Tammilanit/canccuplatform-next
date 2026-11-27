"""What the pool and the status events read before any tenant is set: the own applications to
open, and the events a client serves."""

from __future__ import annotations

from canccu_kit import SecretBox
from conftest import SHARED_ID

from canccu_bot import store
from canccu_bot.db import Db

BOX = SecretBox({1: b"s" * 32}, 1)


async def own(db: Db, tenant: str, app_id: str, token: str, aad_tenant: str | None = None) -> None:
    sealed = BOX.seal(token, f"bot:token:{aad_tenant or tenant}:{app_id}")
    async with db.tenant(tenant) as conn:
        await conn.execute(
            "INSERT INTO bot_connections (mode, application_id, bot_token, client_secret,"
            " key_version, revision) VALUES ('own', $1, $2, $3, 1, 1)",
            app_id,
            sealed,
            BOX.seal("secret", f"bot:secret:{tenant}:{app_id}"),
        )
    async with db.platform() as conn:
        await conn.execute(
            "INSERT INTO bot_application_routes (application_id, tenant_id) VALUES ($1, $2)",
            app_id,
            tenant,
        )


async def route(db: Db, guild_id: str, tenant: str, app_id: str) -> None:
    async with db.platform() as conn:
        await conn.execute(
            "INSERT INTO bot_guild_routes (guild_id, tenant_id, application_id)"
            " VALUES ($1, $2, $3)",
            guild_id,
            tenant,
            app_id,
        )


async def test_own_applications_open_with_their_event_s_tokens(db: Db) -> None:
    await own(db, "ev-a", "100000000000000003", "token-a")
    await own(db, "ev-b", "100000000000000005", "token-b")
    assert await store.own_applications(db, BOX) == {
        "100000000000000003": "token-a",
        "100000000000000005": "token-b",
    }


async def test_a_token_sealed_for_another_event_is_left_closed(db: Db) -> None:
    await own(db, "ev-a", "100000000000000003", "token-a", aad_tenant="ev-b")
    assert await store.own_applications(db, BOX) == {}


async def test_the_shared_client_serves_the_events_whose_guild_it_serves(db: Db) -> None:
    await route(db, "100000000000000010", "ev-a", SHARED_ID)
    await route(db, "100000000000000011", "ev-b", SHARED_ID)
    await route(db, "100000000000000012", "ev-c", "100000000000000003")
    assert sorted(await store.tenants_served(db, SHARED_ID)) == ["ev-a", "ev-b"]


async def test_an_own_client_serves_its_event_bound_or_not(db: Db) -> None:
    await own(db, "ev-c", "100000000000000003", "token-c")
    assert await store.tenants_served(db, "100000000000000003") == ["ev-c"]


async def test_own_application_ids_are_read_without_a_tenant(db: Db) -> None:
    await own(db, "ev-a", "100000000000000003", "token-a")
    assert await store.own_application_ids(db) == ["100000000000000003"]
