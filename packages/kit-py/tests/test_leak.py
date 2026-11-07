from __future__ import annotations

from dataclasses import dataclass, field, replace

import pytest

from canccu_kit.bus import Event
from canccu_kit.tenant import current_tenant, require_tenant
from canccu_kit.testing import TenantLeak, assert_tenant_isolation, deliver_as, tenant_event


@dataclass
class ToyStore:
    """A toy module store: a scoped one keeps rows per tenant, a leaky one in one list."""

    scoped: bool
    rows: list[tuple[str, str]] = field(default_factory=list)

    def add(self, note: str) -> None:
        self.rows.append((require_tenant(), note))

    def list(self) -> list[str]:
        return [note for tenant, note in self.rows if not self.scoped or tenant == require_tenant()]


@dataclass
class StoreProbe:
    store: ToyStore
    seen: list[str | None] = field(default_factory=list)

    async def seed(self, tenant: str, marker: str) -> None:
        self.seen += [current_tenant(), tenant]
        self.store.add(marker)

    async def read(self, tenant: str) -> object:
        self.seen += [current_tenant(), tenant]
        return {"notes": self.store.list()}


async def test_passes_a_module_that_keeps_tenants_apart() -> None:
    await assert_tenant_isolation(StoreProbe(ToyStore(scoped=True)))


async def test_fails_a_module_that_shows_one_tenants_data_to_another() -> None:
    with pytest.raises(TenantLeak):
        await assert_tenant_isolation(StoreProbe(ToyStore(scoped=False)))


async def test_fails_a_read_that_returns_nothing_because_it_would_prove_nothing() -> None:
    class Empty:
        async def seed(self, tenant: str, marker: str) -> None:
            pass

        async def read(self, tenant: str) -> object:
            return []

    with pytest.raises(AssertionError, match="proves nothing"):
        await assert_tenant_isolation(Empty())


async def test_reads_a_string_as_is() -> None:
    class Text:
        def __init__(self) -> None:
            self.store = ToyStore(scoped=True)

        async def seed(self, tenant: str, marker: str) -> None:
            self.store.add(marker)

        async def read(self, tenant: str) -> object:
            return ",".join(self.store.list())

    await assert_tenant_isolation(Text())


async def test_runs_seed_and_read_inside_each_tenants_context() -> None:
    probe = StoreProbe(ToyStore(scoped=True))
    await assert_tenant_isolation(probe, ("t-one", "t-two"))
    assert probe.seen == ["t-one", "t-one", "t-two", "t-two"] * 2


async def test_deliver_as_runs_a_handler_as_the_bus_would() -> None:
    store = ToyStore(scoped=True)

    async def handler(event: Event) -> None:
        store.add(str(event.data["note"]))

    class Consumer:
        async def seed(self, tenant: str, marker: str) -> None:
            await deliver_as(handler, tenant_event(tenant, "pizza.order.placed", {"note": marker}))

        async def read(self, tenant: str) -> object:
            return store.list()

    await assert_tenant_isolation(Consumer())


async def test_deliver_as_refuses_an_event_without_a_tenant() -> None:
    async def handler(event: Event) -> None:
        pass

    event = replace(tenant_event("demo", "pizza.order.placed"), tenant=None)
    with pytest.raises(ValueError, match="tenant"):
        await deliver_as(handler, event)
