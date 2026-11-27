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
