"""The live state's store on a real Valkey (live.ValkeyLive), with the same behaviour the in-memory
one in fakes.py gives the other tests. Skipped unless CANCCU_VALKEY_URL is set; CI runs them in
the `module (bot)` job."""

from __future__ import annotations

import asyncio
import os
import secrets
from collections.abc import AsyncIterator

import pytest

from canccu_bot.live import ValkeyLive, clear, live_key

URL = os.environ.get("CANCCU_VALKEY_URL")


@pytest.fixture
async def live() -> AsyncIterator[tuple[ValkeyLive, str]]:
    if not URL:
        pytest.skip("needs CANCCU_VALKEY_URL")
    store = ValkeyLive.from_url(URL)
    tenant = f"test-{secrets.token_hex(4)}"
    yield store, tenant
    await clear(store, tenant)
    await store.close()


async def test_a_hash_is_replaced_whole_and_edited_by_field(live: tuple[ValkeyLive, str]) -> None:
    store, tenant = live
    key = live_key(tenant, "presence")
    await store.replace(key, {"1": "a", "2": "b"})
    await store.replace(key, {"3": "c"})
    await store.hset(key, "4", "d")
    await store.hdel(key, "3")
    assert await store.hgetall(key) == {"4": "d"}
    await store.replace(key, {})
    assert await store.hgetall(key) == {}


async def test_a_field_counts_up_and_down(live: tuple[ValkeyLive, str]) -> None:
    store, tenant = live
    key = live_key(tenant, "guild")
    assert await store.hincr(key, "member_count", 3) == 3
    assert await store.hincr(key, "member_count", -1) == 2


async def test_a_counter_expires_after_its_first_count(live: tuple[ValkeyLive, str]) -> None:
    store, tenant = live
    key = f"bot:count:{tenant}:messages:60"
    assert await store.incr(key, 300) == 1
    await asyncio.sleep(0.1)
    assert await store.incr(key, 300) == 2  # a later count does not push the expiry back
    await asyncio.sleep(0.3)
    assert await store.mget([key, "bot:count:none"]) == [None, None]


async def test_a_value_is_put_read_and_deleted(live: tuple[ValkeyLive, str]) -> None:
    store, tenant = live
    key = f"bot:count:{tenant}:flushed"
    await store.put(key, "120", 60_000)
    assert await store.get(key) == "120"
    await store.delete(key)
    assert await store.get(key) is None


async def test_clear_drops_every_part_of_the_event(live: tuple[ValkeyLive, str]) -> None:
    store, tenant = live
    for part in ("presence", "voice", "channels"):
        await store.hset(live_key(tenant, part), "1", "x")
    await clear(store, tenant)
    for part in ("presence", "voice", "channels"):
        assert await store.hgetall(live_key(tenant, part)) == {}
