"""Host → tenant (0013 item 2, contracts/tenants.md, Resolving the tenant).

The tenant comes only from the request's hostname, through the tenants API; a module never reads
the registry itself.
"""

from __future__ import annotations

import ipaddress
import re
import time
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Literal, cast

import httpx

from .access import TenantContext
from .bus import Event
from .config import ConfigError
from .errors import KitError

DEMO_TENANT = "demo"
"""The tenant the IP-mode demo stack serves."""

RESOLVE_CACHE_SECONDS = 30


class UnknownHost(KitError):
    """An unknown host gets 404 with no detail, so it learns nothing about the registry."""

    status = 404
    code = "not_found"

    def __init__(self) -> None:
        super().__init__("Not found.")


class TenantsUnavailable(KitError):
    status = 503
    code = "tenants_unavailable"


@dataclass(frozen=True)
class Resolution:
    """A tenant with its context, or `platform`: the central sign-in host or the superadmin
    hostname, which are outside tenant resolution."""

    kind: Literal["tenant", "platform"]
    context: TenantContext | None = None
    host: str | None = None


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _is_ipv6(host: str) -> bool:
    try:
        ipaddress.IPv6Address(host)
    except ValueError:
        return False
    return True


_PORT_RE = re.compile(r":\d*$")


def normalize_host(host: str | None) -> str | None:
    """Lowercase, without the port or a trailing dot; None for an empty host."""
    h = (host or "").strip().lower()
    if h.startswith("["):
        end = h.find("]")
        h = h[1:end] if end != -1 else h[1:]
    elif not _is_ipv6(h):
        h = _PORT_RE.sub("", h)
    h = h.removesuffix(".")
    return h or None


@dataclass(frozen=True)
class IpMode:
    version: str
    """The platform version; IP mode runs only while it is `dev` (0013 item 2)."""
    load: Callable[[], Awaitable[TenantContext | None]]
    """The demo tenant's context, or None when IP mode must not serve (e.g. it is not the only
    tenant). The kit refuses anything but the demo tenant whatever this returns."""


@dataclass
class _Cached:
    at: float
    context: TenantContext | None


class TenantResolver:
    """Resolves a request's Host to its tenant, caching answers (unknown hosts too) briefly.

    `tenants_url` is the tenants module's internal base URL, e.g. `http://tenants:8000`;
    `platform_hosts` are the platform's own hostnames (sign-in, superadmin), never resolved to a
    tenant; only the CI demo stack sets `ip_mode`.
    """

    def __init__(
        self,
        tenants_url: str,
        *,
        platform_hosts: Iterable[str] = (),
        ip_mode: IpMode | None = None,
        http: httpx.AsyncClient | None = None,
        cache_seconds: float = RESOLVE_CACHE_SECONDS,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        if ip_mode is not None and ip_mode.version != "dev":
            raise ConfigError("IP mode runs only while the platform version is dev")
        self._tenants_url = tenants_url.rstrip("/")
        self._platform_hosts = {h for h in map(normalize_host, platform_hosts) if h is not None}
        self._ip_mode = ip_mode
        self._http = http or httpx.AsyncClient(timeout=5.0)
        self._cache_seconds = cache_seconds
        self._now = now
        self._cache: dict[str, _Cached] = {}

    async def resolve(self, raw_host: str | None) -> Resolution:
        host = normalize_host(raw_host)
        if host is None:
            raise UnknownHost()
        if host in self._platform_hosts:
            return Resolution("platform", host=host)
        hit = self._cache.get(host)
        if hit is not None and self._now() - hit.at < self._cache_seconds:
            context = hit.context
        else:
            context = await (self._ip_mode_context() if _is_ip(host) else self._lookup(host))
            self._cache[host] = _Cached(self._now(), context)
        if context is None:
            raise UnknownHost()
        return Resolution("tenant", context)

    async def _ip_mode_context(self) -> TenantContext | None:
        if self._ip_mode is None:
            return None
        context = await self._ip_mode.load()
        return context if context is not None and context["tenant_id"] == DEMO_TENANT else None

    async def _lookup(self, host: str) -> TenantContext | None:
        try:
            response = await self._http.get(
                f"{self._tenants_url}/internal/tenants/resolve", params={"host": host}
            )
        except httpx.HTTPError as exc:
            raise TenantsUnavailable(f"tenants module unreachable: {type(exc).__name__}") from exc
        if response.status_code in (400, 404):
            return None
        if not response.is_success:
            raise TenantsUnavailable(f"tenants module answered {response.status_code}")
        try:
            return cast(TenantContext, response.json())
        except ValueError as exc:
            raise TenantsUnavailable("tenants module answered no JSON") from exc

    def handle_event(self, event: Event) -> None:
        """Feed every tenants event here: a tenant event drops that tenant, a platform event all."""
        if event.source != "tenants":
            return
        if event.tenant is None:
            self._cache.clear()
            return
        for host in [
            h
            for h, c in self._cache.items()
            if c.context is not None and c.context["tenant_id"] == event.tenant
        ]:
            del self._cache[host]

    async def close(self) -> None:
        await self._http.aclose()
