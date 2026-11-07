from __future__ import annotations

import itertools
from collections.abc import Awaitable, Callable

import httpx
import pytest

from canccu_kit.access import TenantContext
from canccu_kit.bus import Event
from canccu_kit.config import ConfigError
from canccu_kit.resolve import (
    IpMode,
    Resolution,
    TenantResolver,
    TenantsUnavailable,
    UnknownHost,
    normalize_host,
)

from .conftest import tenant_context

DEMO = tenant_context()
_ids = itertools.count()


class FakeTenants:
    """The tenants module's resolve endpoint: answers from `hosts`, records each asked host."""

    def __init__(self, hosts: dict[str, TenantContext]) -> None:
        self.hosts = hosts
        self.asked: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/internal/tenants/resolve"
        host = request.url.params.get("host", "")
        self.asked.append(host)
        ctx = self.hosts.get(host)
        if ctx is None:
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "no"}})
        return httpx.Response(200, json=ctx)

    def http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self))


def event(type: str, tenant: str | None = None) -> Event:
    return Event(
        id=f"e-{next(_ids)}",
        type=type,
        version=1,
        time="2026-01-01T00:00:00Z",
        source="tenants",
        tenant=tenant,
        data={},
    )


def loader(ctx: TenantContext | None) -> Callable[[], Awaitable[TenantContext | None]]:
    async def load() -> TenantContext | None:
        return ctx

    return load


def test_normalize_host_lowercases_and_drops_the_port_and_a_trailing_dot() -> None:
    assert normalize_host("Demo.Example.org:8443") == "demo.example.org"
    assert normalize_host("demo.example.org.") == "demo.example.org"
    assert normalize_host("[2001:db8::1]:80") == "2001:db8::1"
    assert normalize_host("2001:db8::1") == "2001:db8::1"
    assert normalize_host("192.0.2.1:80") == "192.0.2.1"
    assert normalize_host("") is None
    assert normalize_host(None) is None


async def test_resolves_a_registered_host_through_the_tenants_api_and_caches_it() -> None:
    tenants = FakeTenants({"demo.example.org": DEMO})
    resolver = TenantResolver("http://tenants:8000/", http=tenants.http())
    assert await resolver.resolve("Demo.example.org:443") == Resolution("tenant", DEMO)
    await resolver.resolve("demo.example.org")
    assert tenants.asked == ["demo.example.org"]


async def test_gives_an_unknown_host_404_with_no_detail() -> None:
    resolver = TenantResolver("http://t", http=FakeTenants({}).http())
    with pytest.raises(UnknownHost) as caught:
        await resolver.resolve("nope.example.org")
    assert caught.value.status == 404
    assert caught.value.to_body() == {"error": {"code": "not_found", "message": "Not found."}}
    with pytest.raises(UnknownHost):
        await resolver.resolve(None)


async def test_answers_503_when_the_tenants_module_cannot_be_reached() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("ECONNREFUSED", request=request)

    resolver = TenantResolver(
        "http://t", http=httpx.AsyncClient(transport=httpx.MockTransport(refuse))
    )
    with pytest.raises(TenantsUnavailable) as caught:
        await resolver.resolve("demo.example.org")
    assert caught.value.status == 503


async def test_answers_503_when_the_tenants_module_fails() -> None:
    resolver = TenantResolver(
        "http://t",
        http=httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(500))),
    )
    with pytest.raises(TenantsUnavailable, match="500"):
        await resolver.resolve("demo.example.org")


async def test_drops_the_cache_on_tenants_events() -> None:
    tenants = FakeTenants({"demo.example.org": DEMO})
    resolver = TenantResolver("http://t", http=tenants.http())
    await resolver.resolve("demo.example.org")
    resolver.handle_event(event("tenants.flags.changed", "other"))
    await resolver.resolve("demo.example.org")
    resolver.handle_event(event("tenants.flags.changed", "demo"))
    await resolver.resolve("demo.example.org")
    resolver.handle_event(event("tenants.hostname.changed"))
    await resolver.resolve("demo.example.org")
    assert len(tenants.asked) == 3


async def test_expires_cached_answers_also_unknown_hosts() -> None:
    now = 0.0
    tenants = FakeTenants({})
    resolver = TenantResolver("http://t", http=tenants.http(), now=lambda: now)
    for _ in range(2):
        with pytest.raises(UnknownHost):
            await resolver.resolve("x.example.org")
    now = 31.0
    with pytest.raises(UnknownHost):
        await resolver.resolve("x.example.org")
    assert len(tenants.asked) == 2


async def test_keeps_the_platforms_own_hostnames_outside_resolution() -> None:
    tenants = FakeTenants({})
    resolver = TenantResolver(
        "http://t",
        http=tenants.http(),
        platform_hosts=["Sign-in.example.org", "admin.example.org"],
    )
    assert await resolver.resolve("sign-in.example.org:443") == Resolution(
        "platform", host="sign-in.example.org"
    )
    assert tenants.asked == []


async def test_ip_mode_serves_the_demo_tenant_on_an_ip_literal_while_dev() -> None:
    tenants = FakeTenants({})
    resolver = TenantResolver(
        "http://t", http=tenants.http(), ip_mode=IpMode(version="dev", load=loader(DEMO))
    )
    assert await resolver.resolve("192.0.2.1:80") == Resolution("tenant", DEMO)
    assert await resolver.resolve("[2001:db8::1]") == Resolution("tenant", DEMO)
    assert tenants.asked == []


async def test_ip_mode_never_applies_to_a_hostname() -> None:
    resolver = TenantResolver(
        "http://t", http=FakeTenants({}).http(), ip_mode=IpMode(version="dev", load=loader(DEMO))
    )
    with pytest.raises(UnknownHost):
        await resolver.resolve("unregistered.example.org")


def test_ip_mode_refuses_to_start_on_a_release_version() -> None:
    with pytest.raises(ConfigError):
        TenantResolver("http://t", ip_mode=IpMode(version="v1.2.0", load=loader(DEMO)))


async def test_ip_mode_gives_404_when_the_loader_declines_or_returns_another_tenant() -> None:
    none = TenantResolver("http://t", ip_mode=IpMode(version="dev", load=loader(None)))
    with pytest.raises(UnknownHost):
        await none.resolve("192.0.2.1")
    other = TenantResolver(
        "http://t",
        ip_mode=IpMode(version="dev", load=loader(tenant_context(tenant_id="real-event"))),
    )
    with pytest.raises(UnknownHost):
        await other.resolve("192.0.2.1")


async def test_without_ip_mode_an_ip_literal_is_an_unknown_host() -> None:
    tenants = FakeTenants({})
    resolver = TenantResolver("http://t", http=tenants.http())
    with pytest.raises(UnknownHost):
        await resolver.resolve("192.0.2.1")
    assert tenants.asked == []


async def test_keeps_the_cache_bounded_and_drops_expired_entries() -> None:
    now = 0.0
    resolver = TenantResolver(
        "http://t", http=FakeTenants({}).http(), max_entries=3, now=lambda: now
    )
    for i in range(10):
        with pytest.raises(UnknownHost):
            await resolver.resolve(f"x{i}.example.org")
    assert resolver.cache_size == 3
    now = 31.0
    with pytest.raises(UnknownHost):
        await resolver.resolve("x9.example.org")
    assert resolver.cache_size == 3


@pytest.mark.parametrize("body", [{}, {"tenant_id": "../x"}, []])
async def test_answers_503_for_a_context_without_a_valid_tenant_id(body: object) -> None:
    http = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body))
    )
    with pytest.raises(TenantsUnavailable):
        await TenantResolver("http://t", http=http).resolve("demo.example.org")


async def test_forgets_unknown_hosts_on_any_tenants_event() -> None:
    tenants = FakeTenants({})
    resolver = TenantResolver("http://t", http=tenants.http())
    with pytest.raises(UnknownHost):
        await resolver.resolve("new.example.org")
    tenants.hosts["new.example.org"] = DEMO
    resolver.handle_event(event("tenants.flags.changed", "other"))
    assert await resolver.resolve("new.example.org") == Resolution("tenant", DEMO)
