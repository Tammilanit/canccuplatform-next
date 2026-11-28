"""The lease and status keys on a real Valkey: only the holder renews or releases a lease.

Skipped unless CANCCU_VALKEY_URL is set; CI runs them in the `module (bot)` job."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest

from canccu_bot.lease import ValkeyKeys

URL = os.environ.get("CANCCU_VALKEY_URL")


@pytest.fixture
async def keys() -> AsyncIterator[ValkeyKeys]:
    if not URL:
        pytest.skip("needs CANCCU_VALKEY_URL")
    keys = ValkeyKeys.from_url(URL)
    yield keys
    await keys.close()


async def test_only_one_holder_gets_the_lease(keys: ValkeyKeys) -> None:
    key = f"bot:lease:test-{uuid.uuid4()}"
    assert await keys.acquire(key, "c1", 30_000)
    assert not await keys.acquire(key, "c2", 30_000)
    assert await keys.get(key) == "c1"


async def test_only_the_holder_renews_and_releases(keys: ValkeyKeys) -> None:
    key = f"bot:lease:test-{uuid.uuid4()}"
    await keys.acquire(key, "c1", 30_000)
    assert not await keys.renew(key, "c2", 30_000)
    await keys.release(key, "c2")
    assert await keys.get(key) == "c1"
    assert await keys.renew(key, "c1", 30_000)
    await keys.release(key, "c1")
    assert await keys.get(key) is None


async def test_a_lease_runs_out(keys: ValkeyKeys) -> None:
    key = f"bot:lease:test-{uuid.uuid4()}"
    await keys.acquire(key, "c1", 50)
    await asyncio.sleep(0.1)
    assert not await keys.renew(key, "c1", 30_000)
    assert await keys.acquire(key, "c2", 30_000)


async def test_a_status_is_kept_for_its_time(keys: ValkeyKeys) -> None:
    key = f"bot:status:test-{uuid.uuid4()}"
    await keys.put(key, '{"status": "ready"}', 50)
    assert await keys.get(key) == '{"status": "ready"}'
    await asyncio.sleep(0.1)
    assert await keys.get(key) is None


async def test_a_bind_state_is_taken_once_by_racing_callbacks(keys: ValkeyKeys) -> None:
    key = f"bot:bind:test-{uuid.uuid4()}"
    await keys.put(key, '{"tenant": "ev-a"}', 30_000)
    taken = await asyncio.gather(*(keys.take(key) for _ in range(5)))
    assert sorted(taken, key=str) == [None, None, None, None, '{"tenant": "ev-a"}']


async def test_a_hash_is_written_behind_read_back_and_deleted(keys: ValkeyKeys) -> None:
    key = f"bot:live:test-{uuid.uuid4()}:presence"
    await keys.hash_write(key, {"1": "online", "2": "idle"}, set(), 60_000)
    await keys.hash_write(key, {"3": "dnd"}, {"1"}, 60_000)
    assert await keys.hash_read(key) == {"2": "idle", "3": "dnd"}
    await keys.delete(key)
    assert await keys.hash_read(key) == {}


async def test_a_counter_counts_and_runs_out(keys: ValkeyKeys) -> None:
    key = f"bot:count:test-{uuid.uuid4()}"
    assert await keys.incr(key, 50) == 1
    assert await keys.incr(key, 50) == 2
    assert await keys.get(key) == "2"
    await asyncio.sleep(0.1)
    assert await keys.get(key) is None
