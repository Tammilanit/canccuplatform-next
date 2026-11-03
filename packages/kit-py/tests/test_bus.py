from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime

import pytest

from cp_kit import STREAM_MAXLEN, Bus, Event, InvalidEventType, correlation
from cp_kit.bus import InvalidEnvelope, parse_envelope
from cp_kit.testing import MemoryStreamStore

TIME_RE = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")


async def test_publish_writes_envelope_to_module_stream(store: MemoryStreamStore) -> None:
    bus = Bus(store, "screen")
    event = await bus.publish("screen.slide.shown", {"slide": 3}, version=1)

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
    await Bus(store, "screen").publish("screen.slide.shown", {}, version=1)
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
        await Bus(store, "screen").publish(event_type, {}, version=1)
    assert store.calls == []


async def test_publish_refuses_bad_version(store: MemoryStreamStore) -> None:
    with pytest.raises(ValueError):
        await Bus(store, "screen").publish("screen.slide.shown", {}, version=0)


async def test_publish_carries_correlation_id(store: MemoryStreamStore) -> None:
    bus = Bus(store, "screen")
    with correlation("req-1"):
        await bus.publish("screen.slide.shown", {}, version=1)
    await bus.publish("screen.slide.shown", {}, version=1, correlation_id="explicit")
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
    await Bus(store, "admin").publish("admin.settings.changed", {"module": "screen"}, version=1)
    await Bus(store, "tournament").publish("tournament.match.finished", {}, version=1)
    received = await collect(store, ["admin", "tournament"], until=2)
    assert sorted(e.source for e in received) == ["admin", "tournament"]


async def test_handler_error_does_not_stop_subscription(store: MemoryStreamStore) -> None:
    store.append_raw("events:admin", {"event": envelope(id="a")})
    store.append_raw("events:admin", {"event": envelope(id="b")})
    seen: list[str] = []
    done = asyncio.Event()

    async def handler(event: Event) -> None:
        seen.append(event.id)
        if event.id == "a":
            raise RuntimeError("boom")
        done.set()

    sub = Bus(store, "screen").subscribe(["admin"], handler, from_id="0-0", block_ms=50)
    await asyncio.wait_for(done.wait(), 2)
    await sub.close()
    assert seen == ["a", "b"]
