"""Who may see what on a tenant's hostname (contracts/tenants.md, Access; 0013 items 11 and 33).

The kit implements these rules once; modules call them and never compare addresses themselves.
`client_ip` is the address the edge Caddy forwards: Caddy is the only trusted proxy.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import os
import secrets
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Literal, TypedDict

from .errors import KitError


class Venue(TypedDict):
    id: str
    name: str
    addresses: list[str]


class VenueIpCheck(TypedDict):
    enabled: bool
    disabled_until: str | None
    reason: str | None


class TenantContext(TypedDict):
    """contracts/tenants.openapi.yaml, TenantContext: what the kit needs to serve a request."""

    tenant_id: str
    status: Literal["draft", "live", "archived"]
    primary_hostname: str | None
    time_zone: str
    info_page_mode: Literal["public", "venue_only", "sign_in"]
    membership: Literal["open", "closed"]
    admin_access: Literal["restricted", "internet"]
    venue: Venue | None
    venue_ip_check: VenueIpCheck
    flags_version: int
    flags: dict[str, bool]


DEFAULT_TAILSCALE_CIDRS: tuple[str, ...] = ("100.64.0.0/10", "fd7a:115c:a1e0::/48")

IpNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network
IpAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


class DeviceTokenInvalid(KitError):
    status = 401
    code = "device_token_invalid"


class VenueIpMismatch(KitError):
    status = 403
    code = "venue_ip_mismatch"


class InfoPagesClosed(KitError):
    status = 403
    code = "info_pages_closed"


class AdminAccessRestricted(KitError):
    status = 403
    code = "admin_access_restricted"


def _address(ip: str) -> IpAddress | None:
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


def _networks(cidrs: Iterable[str]) -> Iterable[IpNetwork]:
    for cidr in cidrs:
        # strict=False takes `192.0.2.10/24` as its /24, the way a BlockList subnet does. A
        # malformed prefix is skipped, so it can only narrow access, never widen it.
        try:
            yield ipaddress.ip_network(cidr.strip(), strict=False)
        except ValueError:
            continue


def ip_in_cidrs(ip: str | None, cidrs: Iterable[str]) -> bool:
    """Whether `ip` lies in any prefix; IPv4-mapped IPv6 (`::ffff:a.b.c.d`) counts as IPv4."""
    if ip is None:
        return False
    address = _address(ip)
    if address is None:
        return False
    return any(
        address.version == network.version and address in network for network in _networks(cidrs)
    )


def _from_venue(ctx: TenantContext, client_ip: str | None) -> bool:
    venue = ctx["venue"]
    return venue is not None and ip_in_cidrs(client_ip, venue["addresses"])


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def venue_ip_check_active(ctx: TenantContext, now: datetime | None = None) -> bool:
    """Whether the venue IP check applies now.

    The emergency switch turns it off only until `disabled_until`; a switch without an end, or
    with an end that does not parse, keeps the check on, so a bad row fails closed.
    """
    check = ctx["venue_ip_check"]
    until = check["disabled_until"]
    if check["enabled"] or until is None:
        return True
    try:
        end = _parse_time(until)
    except ValueError:
        return True
    return (now or datetime.now(UTC)) >= end


def check_screen_access(
    ctx: TenantContext,
    *,
    device_token_valid: bool,
    client_ip: str | None,
    now: datetime | None = None,
) -> None:
    """A screen needs its device token and, unless the switch is off, its event's venue address."""
    if not device_token_valid:
        raise DeviceTokenInvalid()
    if venue_ip_check_active(ctx, now) and not _from_venue(ctx, client_ip):
        raise VenueIpMismatch("this screen is not at its event's venue")


def new_device_token() -> str:
    """A new device token: shown to the device once, stored only as its hash (0013 item 34)."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")


def hash_device_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def device_token_matches(token: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_device_token(token).encode(), stored_hash.encode())


def check_info_access(
    ctx: TenantContext, *, client_ip: str | None, viewer: Literal["guest", "member"]
) -> None:
    """Info pages (read-only, public-facing).

    The mode is visibility, never authorization: passing this grants no write and no personal
    read. Members, event admins and a superadmin in a support window are all `member` here.
    """
    if viewer == "member":
        return
    mode = ctx["info_page_mode"]
    is_open = ctx["status"] != "draft" and (
        mode == "public" or (mode == "venue_only" and _from_venue(ctx, client_ip))
    )
    if not is_open:
        raise InfoPagesClosed("this event's info pages are not open to you")


def tailscale_cidrs(env: Mapping[str, str] | None = None) -> list[str]:
    """`CANCCU_TAILSCALE_CIDRS` (comma-separated), or the Tailscale defaults."""
    source = os.environ if env is None else env
    raw = source.get("CANCCU_TAILSCALE_CIDRS", "").strip()
    if not raw:
        return list(DEFAULT_TAILSCALE_CIDRS)
    return [c.strip() for c in raw.split(",") if c.strip()]


def check_admin_access(
    ctx: TenantContext, client_ip: str | None, tailscale: Sequence[str] | None = None
) -> None:
    """Admin pages and every request that needs a right.

    This only narrows: sign-in and rights are checked as well, always.
    """
    if ctx["admin_access"] == "internet":
        return
    prefixes = tailscale_cidrs() if tailscale is None else tailscale
    if _from_venue(ctx, client_ip) or ip_in_cidrs(client_ip, prefixes):
        return
    raise AdminAccessRestricted("admin is reachable only from the venue or Tailscale")
