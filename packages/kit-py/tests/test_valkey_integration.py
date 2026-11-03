"""Integration test of ValkeyStreamStore and Bus against a real Valkey.

Runs only when CP_VALKEY_URL is set; see README, Integration test.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
import valkey.asyncio as valkey

from cp_kit import STREAM_MAXLEN, Bus, Event, ValkeyStreamStore, new_id
from cp_kit.bus import stream_name

URL = os.environ.get("CP_VALKEY_URL", "")
TIME_RE = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")

pytestmark = pytest.mark.skipif(not URL, reason="CP_VALKEY_URL is not set")


def unique_module() -> str:
    """A module name no other run uses, so reruns and the kit-ts test never share a stream."""
    return f"it{secrets.token_hex(5)}"


class Received:
    """Collects delivered events; `until(n)` waits (at most 5 s) until n have arrived."""

    def __init__(self) -> None:
        self.events: list[Event] = []
        self._arrived = asyncio.Event()

    async def handler(self, event: Event) -> None:
        self.events.append(event)
        self._arrived.set()

    async def until(self, count: int) -> None:
        async with asyncio.timeout(5):
            while len(self.events) < count:
                await self._arrived.wait()
                self._arrived.clear()


class Valkeys:
    def __init__(self) -> None:
        self.raw: valkey.Valkey = valkey.Valkey.from_url(URL, decode_responses=True)
        self.store = ValkeyStreamStore.from_url(URL)
        self.streams: list[str] = []

    def track(self, module: str) -> str:
        name: str = stream_name(module)
        self.streams.append(name)
        return name


@pytest.fixture
async def vk() -> AsyncIterator[Valkeys]:
    v = Valkeys()
    yield v
    if v.streams:
        await v.raw.delete(*v.streams)
    await v.store.close()
    await v.raw.aclose()


async def test_ping(vk: Valkeys) -> None:
    assert await vk.store.ping() is True


async def test_publish_writes_one_event_field_with_a_valid_envelope(vk: Valkeys) -> None:
    module = unique_module()
    stream = vk.track(module)
    sent = await Bus(vk.store, module).publish(f"{module}.thing.happened", {"n": 1}, version=1)

    entries = await vk.raw.xrange(stream)
    assert len(entries) == 1
    _, fields = entries[0]
    assert list(fields) == ["event"]
    body = json.loads(fields["event"])
    assert body["id"] == sent.id
    assert uuid.UUID(body["id"]).version == 7
    assert body["type"] == f"{module}.thing.happened"
    assert body["version"] == 1
    assert body["source"] == module
    assert body["data"] == {"n": 1}
    assert TIME_RE.match(body["time"])


async def test_exact_maxlen_trims_to_that_length(vk: Valkeys) -> None:
    stream = vk.track(unique_module())
    for i in range(12):
        await vk.store.xadd(stream, {"event": f"e{i}"}, maxlen=5, approximate=False)
    assert await vk.raw.xlen(stream) == 5
    entries = await vk.raw.xrange(stream)
    assert [f["event"] for _, f in entries] == ["e7", "e8", "e9", "e10", "e11"]


async def test_approximate_maxlen_trims_whole_nodes(vk: Valkeys) -> None:
    stream = vk.track(unique_module())
    for i in range(300):
        await vk.store.xadd(stream, {"event": f"e{i}"}, maxlen=10, approximate=True)
    length = await vk.raw.xlen(stream)
    # `~` only drops whole stream nodes (100 entries by default) and never goes below MAXLEN,
    # so it ends above 10 here, where an exact MAXLEN would give exactly 10.
    assert 10 < length <= 110


async def test_publish_keeps_the_stream_near_stream_maxlen(vk: Valkeys) -> None:
    module = unique_module()
    stream = vk.track(module)
    async with vk.raw.pipeline(transaction=False) as pipe:
        for _ in range(STREAM_MAXLEN + 500):
            pipe.xadd(stream, {"event": "{}"})
        await pipe.execute()
    await Bus(vk.store, module).publish(f"{module}.thing.happened", {}, version=1)
    length = await vk.raw.xlen(stream)
    assert STREAM_MAXLEN <= length < STREAM_MAXLEN + 500


async def test_subscribe_delivers_once_even_when_an_entry_is_added_twice(vk: Valkeys) -> None:
    source = unique_module()
    stream = vk.track(source)
    received = Received()
    reader = ValkeyStreamStore.from_url(URL)
    subscription = Bus(reader, unique_module()).subscribe(
        [source], received.handler, from_id="0", block_ms=200
    )
    try:
        published = await Bus(vk.store, source).publish(
            f"{source}.thing.happened", {"n": 1}, version=1
        )
        await received.until(1)
        assert received.events[0].id == published.id
        assert received.events[0].data == {"n": 1}

        # At-least-once delivery: the same envelope written again must reach the handler once.
        await vk.store.xadd(stream, {"event": published.to_json()}, maxlen=100, approximate=False)
        following = Event(
            id=new_id(),
            type=f"{source}.thing.happened",
            version=1,
            time=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            source=source,
            data={"n": 2},
        )
        await vk.store.xadd(stream, {"event": following.to_json()}, maxlen=100, approximate=False)
        await received.until(2)
        await asyncio.sleep(0.3)
        assert [e.data["n"] for e in received.events] == [1, 2]
    finally:
        await subscription.close()
        await reader.close()
