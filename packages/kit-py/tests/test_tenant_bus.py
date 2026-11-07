from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from canccu_kit.bus import Bus, Event, InvalidEnvelope, TenantSubscription, parse_envelope
from canccu_kit.tenant import NoTenant, current_tenant, tenant_scope, tenant_stream
from canccu_kit.testing import MemoryStreamStore, tenant_event


def body(store: MemoryStreamStore, i: int = 0) -> dict[str, Any]:
    result: dict[str, Any] = json.loads(store.calls[i].fields["event"])
    return result


class Seen(list[tuple[str | None, Event]]):
    """What a handler saw: the tenant it ran in and the event; `until(n)` waits up to 2 s."""

    def __init__(self) -> None:
        super().__init__()
        self._arrived = asyncio.Event()

    async def handler(self, event: Event) -> None:
        self.append((current_tenant(), event))
        self._arrived.set()

    async def until(self, count: int) -> None:
        async with asyncio.timeout(2):
            while len(self) < count:
                await self._arrived.wait()
                self._arrived.clear()


async def test_publish_writes_a_tenant_event_to_the_tenant_stream(
    store: MemoryStreamStore,
) -> None:
    bus = Bus(store, "pizza")
    with tenant_scope("demo"):
        event = await bus.publish("pizza.order.placed", {"n": 1}, version=1)
    assert store.calls[0].stream == "t:demo:events:pizza"
    sent = body(store)
    assert sent["tenant"] == "demo"
    assert sent["source"] == "pizza"
    assert list(sent) == ["id", "type", "version", "time", "source", "tenant", "data"]
    assert event.tenant == "demo"


async def test_publish_takes_an_explicit_tenant_over_the_context(
    store: MemoryStreamStore,
) -> None:
    with tenant_scope("demo"):
        await Bus(store, "pizza").publish("pizza.order.placed", {}, version=1, tenant="other")
    assert store.calls[0].stream == "t:other:events:pizza"


async def test_publish_refuses_no_tenant_unless_it_is_a_platform_event(
    store: MemoryStreamStore,
) -> None:
    bus = Bus(store, "tenants")
    with pytest.raises(NoTenant):
        await bus.publish("tenants.tenant.created", {}, version=1)
    await bus.publish("tenants.tenant.created", {"tenant_id": "x"}, version=1, platform=True)
    assert [c.stream for c in store.calls] == ["events:tenants"]
    assert "tenant" not in body(store)


async def test_platform_event_ignores_the_context_tenant(store: MemoryStreamStore) -> None:
    with tenant_scope("demo"):
        await Bus(store, "tenants").publish("tenants.tenant.created", {}, version=1, platform=True)
    assert store.calls[0].stream == "events:tenants"
    assert "tenant" not in body(store)


async def test_publish_refuses_a_platform_event_that_also_names_a_tenant() -> None:
    bus = Bus(MemoryStreamStore(), "tenants")
    with pytest.raises(ValueError, match="platform"):
        await bus.publish("tenants.tenant.created", {}, version=1, platform=True, tenant="demo")


def test_envelope_tenant_is_parsed_and_checked() -> None:
    def raw(tenant: object) -> str:
        return json.dumps(
            {
                "id": "1",
                "type": "pizza.order.placed",
                "version": 1,
                "time": "t",
                "source": "pizza",
                "tenant": tenant,
                "data": {},
            }
        )

    assert parse_envelope(raw("demo")).tenant == "demo"
    for bad in ["../x", 5, None]:
        with pytest.raises(InvalidEnvelope):
            parse_envelope(raw(bad))


def subscribe(
    store: MemoryStreamStore, *, from_id: str = "$", rescan_ms: int = 50
) -> tuple[Seen, TenantSubscription]:
    seen = Seen()
    sub = Bus(store, "screen").subscribe_tenants(
        ["pizza"], seen.handler, from_id=from_id, block_ms=20, rescan_ms=rescan_ms
    )
    return seen, sub


def created(tenant: str) -> dict[str, str]:
    return {
        "event": json.dumps(
            {
                "id": f"c-{tenant}",
                "type": "tenants.tenant.created",
                "version": 1,
                "time": "t",
                "source": "tenants",
                "data": {"tenant_id": tenant, "status": "draft"},
            }
        )
    }


def deleted(tenant: str) -> dict[str, str]:
    return {
        "event": json.dumps(
            {
                "id": f"d-{tenant}",
                "type": "tenants.tenant.deleted",
                "version": 1,
                "time": "t",
                "source": "tenants",
                "data": {"tenant_id": tenant},
            }
        )
    }


def entry(tenant: str) -> dict[str, str]:
    return {"event": tenant_event(tenant, "pizza.order.placed").to_json()}


async def test_reads_existing_tenants_and_runs_the_handler_in_the_messages_tenant() -> None:
    store = MemoryStreamStore()
    store.append_raw("t:demo:events:pizza", entry("demo"))
    seen, sub = subscribe(store, from_id="0")
    try:
        await seen.until(1)
        assert seen[0][0] == "demo"
    finally:
        await sub.close()


async def test_existing_streams_start_at_from_id() -> None:
    store = MemoryStreamStore()
    store.append_raw("t:demo:events:pizza", entry("demo"))
    seen, sub = subscribe(store, rescan_ms=10_000)
    try:
        await asyncio.sleep(0.03)
        store.append_raw("t:demo:events:pizza", entry("demo"))
        await seen.until(1)
        await asyncio.sleep(0.05)
        assert len(seen) == 1
    finally:
        await sub.close()


async def test_picks_up_a_new_tenant_from_created_and_reads_it_from_the_start() -> None:
    store = MemoryStreamStore()
    seen, sub = subscribe(store, rescan_ms=10_000)
    try:
        await asyncio.sleep(0.03)
        store.append_raw("t:new-one:events:pizza", entry("new-one"))
        store.append_raw("events:tenants", created("new-one"))
        await seen.until(1)
        assert seen[0][0] == "new-one"
    finally:
        await sub.close()


async def test_finds_a_stream_without_a_created_event_on_the_next_rescan() -> None:
    store = MemoryStreamStore()
    seen, sub = subscribe(store)
    try:
        await asyncio.sleep(0.03)
        store.append_raw("t:late:events:pizza", entry("late"))
        await seen.until(1)
        assert seen[0][0] == "late"
    finally:
        await sub.close()


async def test_drops_a_message_whose_tenant_does_not_match_its_stream() -> None:
    store = MemoryStreamStore()
    seen, sub = subscribe(store)
    try:
        await asyncio.sleep(0.03)
        store.append_raw("t:aaa:events:pizza", entry("bbb"))
        store.append_raw("t:aaa:events:pizza", entry("aaa"))
        await seen.until(1)
        await asyncio.sleep(0.06)
        assert [(t, e.tenant) for t, e in seen] == [("aaa", "aaa")]
    finally:
        await sub.close()


async def test_stops_reading_a_deleted_tenant() -> None:
    store = MemoryStreamStore()
    seen, sub = subscribe(store)
    try:
        await asyncio.sleep(0.03)
        store.append_raw("events:tenants", deleted("gone"))
        await asyncio.sleep(0.04)
        store.append_raw(tenant_stream("pizza", "gone"), entry("gone"))
        await asyncio.sleep(0.12)
        assert seen == []
    finally:
        await sub.close()


async def test_skips_the_rest_of_a_batch_of_a_tenant_deleted_in_it() -> None:
    store = MemoryStreamStore()
    store.append_raw("t:gone:events:pizza", entry("gone"))
    store.append_raw("t:gone:events:pizza", entry("gone"))
    seen = Seen()

    async def handler(event: Event) -> None:
        await seen.handler(event)
        # The deletion lands while the first entry of the batch is handled.
        await sub._dispatch("events:tenants", parse_envelope(deleted("gone")["event"]))

    sub = Bus(store, "screen").subscribe_tenants(["pizza"], handler, from_id="0", block_ms=20)
    try:
        await seen.until(1)
        await asyncio.sleep(0.06)
        assert len(seen) == 1
    finally:
        await sub.close()


async def test_keeps_an_event_arriving_while_another_streams_handler_runs() -> None:
    store = MemoryStreamStore()

    def seed(tenant: str) -> None:
        event = tenant_event(tenant, "pizza.order.placed")
        store.append_raw(tenant_stream("pizza", tenant), {"event": event.to_json()})

    seed("acme")
    seed("beta")
    seen: list[str | None] = []

    async def handler(event: Event) -> None:
        seen.append(event.tenant)
        # While acme's handler runs, beta publishes; that event must not be skipped.
        if event.tenant == "acme":
            seed("beta")
            await asyncio.sleep(0.03)

    sub = Bus(store, "screen").subscribe_tenants(["pizza"], handler, block_ms=20)
    try:
        await asyncio.sleep(0.03)
        seed("acme")
        for _ in range(100):
            if len(seen) >= 2:
                break
            await asyncio.sleep(0.02)
        await asyncio.sleep(0.06)
        assert seen == ["acme", "beta"]
    finally:
        await sub.close()
