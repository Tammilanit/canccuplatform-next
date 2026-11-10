"""Host → tenant (0013 item 2, contracts/tenants.md, Resolving the tenant).

The tenant comes only from the request's hostname, through the tenants API; a module never reads
the registry itself.
"""

from __future__ import annotations

import ipaddress
import re
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Literal, cast

import httpx

from .access import TenantContext
from .bus import Event
from .config import ConfigError
from .errors import KitError
from .service import ServiceIdentity
from .tenant import is_tenant_id

DEMO_TENANT = "demo"
"""The tenant the IP-mode demo stack serves."""

RESOLVE_CACHE_SECONDS = 30
RESOLVE_CACHE_MAX = 10_000
"""The Host header is the client's: without a bound, random hosts would grow the cache forever."""


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
    load: Callable[[], Awaitable[TenantContext | None]] | None = None
    """The demo tenant's context, or None when IP mode must not serve. Left out, the kit asks
    `GET /internal/tenants/ip-mode`, where the tenants module applies the rule (only while `demo`
    is the only tenant), so no module needs a loader of its own. The kit refuses anything but the
    demo tenant whatever the answer."""


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
        service: ServiceIdentity | None = None,
        cache_seconds: float = RESOLVE_CACHE_SECONDS,
        max_entries: int = RESOLVE_CACHE_MAX,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        if ip_mode is not None and ip_mode.version != "dev":
            raise ConfigError("IP mode runs only while the platform version is dev")
        self._tenants_url = tenants_url.rstrip("/")
        self._platform_hosts = {h for h in map(normalize_host, platform_hosts) if h is not None}
        self._ip_mode = ip_mode
        self._http = http or httpx.AsyncClient(timeout=5.0)
        self._service = service
        self._cache_seconds = cache_seconds
        self._now = now
        self._max_entries = max_entries
        # Insertion-ordered, so the first key is the oldest entry.
        self._cache: OrderedDict[str, _Cached] = OrderedDict()

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
            self._cache.pop(host, None)
            context = await (self._ip_mode_context() if _is_ip(host) else self._lookup(host))
            self._remember(host, context)
        if context is None:
            raise UnknownHost()
        return Resolution("tenant", context)

    @property
    def cache_size(self) -> int:
        return len(self._cache)

    def _remember(self, host: str, context: TenantContext | None) -> None:
        self._cache.pop(host, None)
        self._cache[host] = _Cached(self._now(), context)
        while len(self._cache) > self._max_entries:
            self._cache.popitem(last=False)

    async def _ip_mode_context(self) -> TenantContext | None:
        if self._ip_mode is None:
            return None
        if self._ip_mode.load is not None:
            context = await self._ip_mode.load()
        else:
            context = await self._internal("ip-mode", {}, none=(404,))
        return context if context is not None and context["tenant_id"] == DEMO_TENANT else None

    async def _lookup(self, host: str) -> TenantContext | None:
        # 400 too: a host the tenants module cannot even parse is unknown, not an outage.
        return await self._internal("resolve", {"host": host}, none=(404, 400))

    async def by_id(self, tenant_id: str) -> TenantContext | None:
        """Another event's context by its id, in every status; None for an unknown id. Only for
        actions that span events (contracts/tenants.md, Another event by its id): a request's own
        tenant still comes from its hostname. Not cached, so an action sees the event as it is."""
        if not is_tenant_id(tenant_id):  # never let an id reshape the path
            return None
        context = await self._internal(f"tenants/{tenant_id}", {}, none=(404,))
        if context is not None and context["tenant_id"] != tenant_id:
            raise TenantsUnavailable("tenants module answered another tenant")
        return context

    async def _internal(
        self, path: str, params: dict[str, str], *, none: tuple[int, ...]
    ) -> TenantContext | None:
        """The context the tenants module answers on `path`, or None on one of `none` statuses."""
        headers = self._service.headers("tenants") if self._service is not None else {}
        try:
            response = await self._http.get(
                f"{self._tenants_url}/internal/tenants/{path}", params=params, headers=headers
            )
        except httpx.HTTPError as exc:
            raise TenantsUnavailable(f"tenants module unreachable: {type(exc).__name__}") from exc
        if response.status_code in none:
            return None
        if not response.is_success:
            raise TenantsUnavailable(f"tenants module answered {response.status_code}")
        try:
            body = response.json()
        except ValueError as exc:
            raise TenantsUnavailable("tenants module answered no JSON") from exc
        # The id goes into keys, streams and paths: never trust it unchecked.
        tenant_id = body.get("tenant_id") if isinstance(body, dict) else None
        if not isinstance(tenant_id, str) or not is_tenant_id(tenant_id):
            raise TenantsUnavailable("tenants module answered without a valid tenant id")
        return cast(TenantContext, body)

    def handle_event(self, event: Event) -> None:
        """Feed every tenants event here: a tenant event drops that tenant, a platform event all.

        Any tenants event also drops unknown hosts, so a hostname just added resolves at once.
        """
        if event.source != "tenants":
            return
        if event.tenant is None:
            self._cache.clear()
            return
        for host in [
            h
            for h, c in self._cache.items()
            if c.context is None or c.context["tenant_id"] == event.tenant
        ]:
            del self._cache[host]

    async def close(self) -> None:
        await self._http.aclose()
