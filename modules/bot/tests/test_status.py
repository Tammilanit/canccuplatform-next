"""`bot.client.changed`: per event, at most once a minute, the last status winning."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from canccu_kit import Bus
from canccu_kit.testing import MemoryStreamStore

from canccu_bot.status import ClientEvents

READY = {"status": "ready", "error_code": None, "since": "2026-11-27T10:00:00Z"}
FAILED = {"status": "failed", "error_code": "token_invalid", "since": "2026-11-27T10:01:00Z"}
LIMITED = {"status": "rate_limited", "error_code": None, "since": "2026-11-27T10:02:00Z"}


def emitted(store: MemoryStreamStore, tenant: str) -> list[dict[str, Any]]:
    entries = store.streams.get(f"t:{tenant}:events:bot", [])
    return [json.loads(fields["event"])["data"] for _, fields in entries]


def make(tenants: dict[str, list[str]]) -> tuple[ClientEvents, MemoryStreamStore]:
    store = MemoryStreamStore()

    async def tenants_of(application_id: str) -> list[str]:
        return tenants.get(application_id, [])

    return ClientEvents(Bus(store, "bot"), tenants_of, interval_s=0.05), store


async def test_the_first_change_goes_out_at_once() -> None:
    events, store = make({"app": ["ev-a"]})
    await events.changed("app", FAILED)
    assert emitted(store, "ev-a") == [FAILED]
    await events.close()


async def test_changes_within_a_minute_send_only_the_last() -> None:
    events, store = make({"app": ["ev-a"]})
    await events.changed("app", FAILED)
    await events.changed("app", READY)
    await events.changed("app", LIMITED)
    assert emitted(store, "ev-a") == [FAILED]
    await asyncio.sleep(0.08)
    assert emitted(store, "ev-a") == [FAILED, LIMITED]
    await events.close()


async def test_the_shared_client_s_change_reaches_every_event_on_it() -> None:
    events, store = make({"shared": ["ev-a", "ev-b"]})
    await events.changed("shared", FAILED)
    assert emitted(store, "ev-a") == emitted(store, "ev-b") == [FAILED]
    await events.close()


async def test_a_client_serving_no_event_emits_nothing() -> None:
    events, store = make({})
    await events.changed("app", FAILED)
    assert store.streams == {}
    await events.close()
