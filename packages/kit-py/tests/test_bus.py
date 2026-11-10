from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from datetime import datetime

import pytest

from canccu_kit import STREAM_MAXLEN, Bus, Event, InvalidEventType, correlation
from canccu_kit.bus import HANDLER_TRIES, InvalidEnvelope, parse_envelope
from canccu_kit.testing import MemoryStreamStore

TIME_RE = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")


async def test_publish_writes_envelope_to_module_stream(store: MemoryStreamStore) -> None:
    bus = Bus(store, "screen")
    event = await bus.publish("screen.slide.shown", {"slide": 3}, version=1, platform=True)

    [call] = store.calls
    assert call.stream == "events:screen"
    assert list(call.fields) == ["event"]
    body = json.loads(call.fields["event"])
    assert set(body) == {"id", "type", "version", "time", "source", "data"}
    assert body["type"] == "screen.slide.shown"
    assert body["version"] == 1
    assert body["source"] == "screen"
    assert body["data"] == {"slide": 3}
    assert uuid.UUID(body["id"]).version == 7
    assert TIME_RE.match(body["time"])
    datetime.fromisoformat(body["time"].replace("Z", "+00:00"))
    assert event.id == body["id"]


async def test_publish_trims_stream_with_approximate_maxlen(store: MemoryStreamStore) -> None:
    await Bus(store, "screen").publish("screen.slide.shown", {}, version=1, platform=True)
    [call] = store.calls
    assert STREAM_MAXLEN == 10000
    assert call.maxlen == 10000
    assert call.approximate is True


@pytest.mark.parametrize(
    "event_type",
    [
        "screen.shown",
        "Screen.slide.shown",
        "screen.slide.shown.now",
        "screen..shown",
        "tournament.match.finished",
    ],
)
async def test_publish_refuses_bad_type(store: MemoryStreamStore, event_type: str) -> None:
    with pytest.raises(InvalidEventType):
        await Bus(store, "screen").publish(event_type, {}, version=1, platform=True)
    assert store.calls == []


async def test_publish_refuses_bad_version(store: MemoryStreamStore) -> None:
    with pytest.raises(ValueError):
        await Bus(store, "screen").publish("screen.slide.shown", {}, version=0, platform=True)


async def test_publish_carries_correlation_id(store: MemoryStreamStore) -> None:
    bus = Bus(store, "screen")
    with correlation("req-1"):
        await bus.publish("screen.slide.shown", {}, version=1, platform=True)
    await bus.publish("screen.slide.shown", {}, version=1, platform=True, correlation_id="explicit")
    first, second = (json.loads(c.fields["event"]) for c in store.calls)
    assert first["correlation_id"] == "req-1"
    assert second["correlation_id"] == "explicit"


def envelope(**overrides: object) -> str:
    body: dict[str, object] = {
        "id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e5f",
        "type": "admin.settings.changed",
        "version": 1,
        "time": "2026-01-01T12:00:00Z",
        "source": "admin",
        "data": {},
    }
    body.update(overrides)
    return json.dumps({k: v for k, v in body.items() if v is not None})


def test_parse_ignores_unknown_fields() -> None:
    event = parse_envelope(envelope(extra="x", correlation_id="c"))
    assert event.type == "admin.settings.changed"
    assert event.correlation_id == "c"


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "[]",
        envelope(id=None),
        envelope(version=0),
        envelope(version=True),
        envelope(data=[]),
        envelope(source="screen"),
        envelope(type="bad"),
    ],
)
def test_parse_rejects_invalid(raw: str) -> None:
    with pytest.raises(InvalidEnvelope):
        parse_envelope(raw)


async def collect(store: MemoryStreamStore, modules: list[str], until: int) -> list[Event]:
    received: list[Event] = []
    done = asyncio.Event()

    async def handler(event: Event) -> None:
        received.append(event)
        if len(received) >= until:
            done.set()

    sub = Bus(store, "screen").subscribe(modules, handler, from_id="0-0", block_ms=50)
    try:
        await asyncio.wait_for(done.wait(), 2)
        await asyncio.sleep(0.1)
    finally:
        await sub.close()
    return received


async def test_subscribe_dedupes_skips_invalid_and_passes_unknown_types(
    store: MemoryStreamStore,
) -> None:
    store.append_raw("events:admin", {"event": envelope(id="a")})
    store.append_raw("events:admin", {"event": envelope(id="a")})  # duplicate delivery
    store.append_raw("events:admin", {"event": "garbage"})
    store.append_raw("events:admin", {"other": "field"})
    store.append_raw(
        "events:admin", {"event": envelope(id="b", type="admin.thing.unknown_happened")}
    )

    received = await collect(store, ["admin"], until=2)

    assert [e.id for e in received] == ["a", "b"]
    assert received[1].type == "admin.thing.unknown_happened"


async def test_subscribe_reads_several_streams(store: MemoryStreamStore) -> None:
    await Bus(store, "admin").publish(
        "admin.settings.changed", {"module": "screen"}, version=1, platform=True
    )
    await Bus(store, "tournament").publish(
        "tournament.match.finished", {}, version=1, platform=True
    )
    received = await collect(store, ["admin", "tournament"], until=2)
    assert sorted(e.source for e in received) == ["admin", "tournament"]


async def test_a_failed_handler_is_retried_with_growing_delays_before_the_next_event(
    store: MemoryStreamStore,
) -> None:
    store.append_raw("events:admin", {"event": envelope(id="a")})
    store.append_raw("events:admin", {"event": envelope(id="b")})
    calls: list[tuple[str, float]] = []
    done = asyncio.Event()

    async def handler(event: Event) -> None:
        calls.append((event.id, time.monotonic()))
        if event.id == "a" and len(calls) < 3:
            raise RuntimeError("boom")
        if event.id == "b":
            done.set()

    sub = Bus(store, "screen").subscribe(
        ["admin"], handler, from_id="0-0", block_ms=50, retry_ms=20
    )
    await asyncio.wait_for(done.wait(), 2)
    await sub.close()
    assert [c[0] for c in calls] == ["a", "a", "a", "b"]
    assert calls[1][1] - calls[0][1] >= 0.018
    assert calls[2][1] - calls[1][1] >= 0.038


async def test_a_failed_event_is_skipped_and_logged_after_the_set_tries(
    store: MemoryStreamStore, caplog: pytest.LogCaptureFixture
) -> None:
    store.append_raw("events:admin", {"event": envelope(id="a")})
    store.append_raw("events:admin", {"event": envelope(id="b")})
    seen: list[str] = []
    done = asyncio.Event()

    async def handler(event: Event) -> None:
        seen.append(event.id)
        if event.id == "a":
            raise RuntimeError("boom")
        done.set()

    sub = Bus(store, "screen").subscribe(
        ["admin"], handler, from_id="0-0", block_ms=50, handler_tries=3, retry_ms=1
    )
    await asyncio.wait_for(done.wait(), 2)
    await sub.close()
    assert seen == ["a", "a", "a", "b"]
    skipped = [r for r in caplog.records if r.getMessage() == "event skipped after failed handler"]
    assert len(skipped) == 1
    assert skipped[0].levelname == "ERROR"
    assert skipped[0].__dict__["event_id"] == "a"
    assert skipped[0].__dict__["tries"] == 3
    failed = [r for r in caplog.records if r.getMessage() == "event handler failed"]
    assert len(failed) == 3


def test_a_handler_tries_five_times_by_default() -> None:
    assert HANDLER_TRIES == 5


async def test_close_stops_retrying(store: MemoryStreamStore) -> None:
    store.append_raw("events:admin", {"event": envelope(id="a")})
    calls = 0
    first = asyncio.Event()

    async def handler(event: Event) -> None:
        nonlocal calls
        calls += 1
        first.set()
        raise RuntimeError("boom")

    sub = Bus(store, "screen").subscribe(
        ["admin"], handler, from_id="0-0", block_ms=50, retry_ms=10_000
    )
    await asyncio.wait_for(first.wait(), 2)
    await asyncio.wait_for(sub.close(), 1)
    assert calls == 1


def test_the_valkey_read_timeout_outlasts_the_blocking_read() -> None:
    # valkey-py's default socket timeout is 5 s, the bus's XREAD blocks 5 s: they raced and the
    # demo stack logged `bus read failed … Timeout` every few seconds.
    from canccu_kit.store import READ_TIMEOUT_S, ValkeyStreamStore

    store = ValkeyStreamStore.from_url("redis://valkey:6379")
    kwargs = store._client.connection_pool.connection_kwargs
    assert kwargs["socket_timeout"] == READ_TIMEOUT_S
    assert READ_TIMEOUT_S * 1000 >= 5000 + 5000


async def test_a_block_too_close_to_the_read_timeout_is_refused() -> None:
    from canccu_kit.store import ValkeyStreamStore

    store = ValkeyStreamStore.from_url("redis://valkey:6379", read_timeout_s=10)
    with pytest.raises(ValueError):
        await store.xread({"events:x": "$"}, block_ms=6000, count=1)
