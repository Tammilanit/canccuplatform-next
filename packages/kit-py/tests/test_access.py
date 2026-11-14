from __future__ import annotations

import re
from datetime import UTC, datetime

import pytest

from canccu_kit.access import (
    DEFAULT_TAILSCALE_CIDRS,
    AdminAccessRestricted,
    DeviceUnknown,
    InfoPagesClosed,
    VenueIpRefused,
    check_admin_access,
    check_info_access,
    check_screen_access,
    device_token_matches,
    hash_device_token,
    ip_in_cidrs,
    new_device_token,
    tailscale_cidrs,
    venue_ip_check_active,
)

from .conftest import tenant_context

VENUE_V4 = "192.0.2.10"
VENUE_V6 = "2001:db8:1::42"
ELSEWHERE = "198.51.100.7"
NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
CIDRS = ["192.0.2.0/24", "2001:db8:1::/48", "203.0.113.5"]


def test_ip_in_cidrs_matches_ipv4_ipv6_mapped_ipv6_and_single_hosts() -> None:
    assert ip_in_cidrs(VENUE_V4, CIDRS)
    assert ip_in_cidrs(f"::ffff:{VENUE_V4}", CIDRS)
    assert ip_in_cidrs(VENUE_V6, CIDRS)
    assert ip_in_cidrs("203.0.113.5", CIDRS)
    assert not ip_in_cidrs("203.0.113.6", CIDRS)
    assert not ip_in_cidrs(ELSEWHERE, CIDRS)


def test_ip_in_cidrs_fails_closed_and_skips_malformed_prefixes() -> None:
    assert not ip_in_cidrs(None, CIDRS)
    assert not ip_in_cidrs("not-an-ip", CIDRS)
    assert not ip_in_cidrs(VENUE_V4, ["garbage", "192.0.2.0/99"])
    # An empty or odd prefix must never widen to /0.
    for odd in ["10.0.0.0/", "10.0.0.0/0x0", "10.0.0.0/ 8", "10.0.0.0/8.0", "2001:db8::/"]:
        assert not ip_in_cidrs("8.8.8.8", [odd])
        assert not ip_in_cidrs("2001:4860::8888", [odd])
    assert not ip_in_cidrs(VENUE_V4, [])


def test_screen_with_a_valid_token_from_the_venue_is_served() -> None:
    ctx = tenant_context()
    check_screen_access(ctx, device_token_valid=True, client_ip=VENUE_V4, now=NOW)
    check_screen_access(ctx, device_token_valid=True, client_ip=VENUE_V6, now=NOW)


def test_screen_is_never_served_on_the_venue_ip_alone() -> None:
    with pytest.raises(DeviceUnknown):
        check_screen_access(tenant_context(), device_token_valid=False, client_ip=VENUE_V4, now=NOW)


def test_screen_outside_the_venue_or_of_an_event_without_venue_is_refused() -> None:
    with pytest.raises(VenueIpRefused):
        check_screen_access(tenant_context(), device_token_valid=True, client_ip=ELSEWHERE, now=NOW)
    with pytest.raises(VenueIpRefused):
        check_screen_access(
            tenant_context(venue=None), device_token_valid=True, client_ip=VENUE_V4, now=NOW
        )


def test_token_alone_serves_while_the_emergency_switch_is_off_until_it_expires() -> None:
    off = tenant_context(
        venue_ip_check={
            "enabled": False,
            "disabled_until": "2026-01-01T18:00:00Z",
            "reason": "new uplink",
        }
    )
    assert not venue_ip_check_active(off, NOW)
    check_screen_access(off, device_token_valid=True, client_ip=ELSEWHERE, now=NOW)
    with pytest.raises(DeviceUnknown):
        check_screen_access(off, device_token_valid=False, client_ip=ELSEWHERE, now=NOW)
    later = datetime(2026, 1, 1, 18, 0, tzinfo=UTC)
    assert venue_ip_check_active(off, later)
    with pytest.raises(VenueIpRefused):
        check_screen_access(off, device_token_valid=True, client_ip=ELSEWHERE, now=later)


def test_check_stays_on_when_the_switch_is_off_without_an_end() -> None:
    no_until = tenant_context(
        venue_ip_check={"enabled": False, "disabled_until": None, "reason": "x"}
    )
    assert venue_ip_check_active(no_until, NOW)


def test_device_tokens_store_only_a_hash_and_compare_in_constant_time() -> None:
    token = new_device_token()
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)
    hashed = hash_device_token(token)
    assert re.fullmatch(r"[0-9a-f]{64}", hashed)
    assert token not in hashed
    assert device_token_matches(token, hashed)
    assert not device_token_matches(new_device_token(), hashed)
    assert not device_token_matches(token, "short")


def test_info_public_lets_guests_in() -> None:
    check_info_access(tenant_context(), client_ip=ELSEWHERE, viewer="guest")


def test_info_venue_only_lets_guests_in_from_the_venue_only() -> None:
    ctx = tenant_context(info_page_mode="venue_only")
    check_info_access(ctx, client_ip=VENUE_V4, viewer="guest")
    with pytest.raises(InfoPagesClosed):
        check_info_access(ctx, client_ip=ELSEWHERE, viewer="guest")
    no_venue = tenant_context(info_page_mode="venue_only", venue=None)
    with pytest.raises(InfoPagesClosed):
        check_info_access(no_venue, client_ip=VENUE_V4, viewer="guest")


def test_info_sign_in_lets_no_guest_in() -> None:
    with pytest.raises(InfoPagesClosed):
        check_info_access(
            tenant_context(info_page_mode="sign_in"), client_ip=VENUE_V4, viewer="guest"
        )


def test_info_of_a_draft_event_lets_no_guest_in_whatever_the_mode() -> None:
    with pytest.raises(InfoPagesClosed):
        check_info_access(tenant_context(status="draft"), client_ip=VENUE_V4, viewer="guest")


def test_info_members_always_may() -> None:
    for mode in ["public", "venue_only", "sign_in"]:
        for status in ["draft", "live", "archived"]:
            check_info_access(
                tenant_context(info_page_mode=mode, status=status),
                client_ip=ELSEWHERE,
                viewer="member",
            )


def test_info_pages_closed_answers_403() -> None:
    assert InfoPagesClosed().to_body()["error"]["code"] == "info_pages_closed"
    assert InfoPagesClosed().status == 403


def test_error_statuses_and_codes() -> None:
    assert (DeviceUnknown.status, DeviceUnknown.code) == (401, "device_unknown")
    assert (VenueIpRefused.status, VenueIpRefused.code) == (403, "venue_ip_refused")
    assert (AdminAccessRestricted.status, AdminAccessRestricted.code) == (
        403,
        "admin_access_restricted",
    )


def test_admin_restricted_only_from_the_venue_or_tailscale() -> None:
    ctx = tenant_context()
    check_admin_access(ctx, VENUE_V4)
    check_admin_access(ctx, "100.101.102.103")
    check_admin_access(ctx, "fd7a:115c:a1e0::5")
    with pytest.raises(AdminAccessRestricted):
        check_admin_access(ctx, ELSEWHERE)
    with pytest.raises(AdminAccessRestricted):
        check_admin_access(tenant_context(venue=None), VENUE_V4)


def test_admin_internet_from_anywhere() -> None:
    check_admin_access(tenant_context(admin_access="internet"), ELSEWHERE)


def test_tailscale_prefixes_come_from_canccu_tailscale_cidrs() -> None:
    assert tailscale_cidrs({}) == list(DEFAULT_TAILSCALE_CIDRS)
    assert tailscale_cidrs({"CANCCU_TAILSCALE_CIDRS": " 10.0.0.0/8 , fd00::/8 "}) == [
        "10.0.0.0/8",
        "fd00::/8",
    ]
    check_admin_access(tenant_context(), "10.1.2.3", ["10.0.0.0/8"])


def test_tailscale_prefixes_default_from_the_process_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CANCCU_TAILSCALE_CIDRS", "10.0.0.0/8")
    check_admin_access(tenant_context(), "10.1.2.3")
    with pytest.raises(AdminAccessRestricted):
        check_admin_access(tenant_context(), "100.101.102.103")


def test_parsed_prefixes_are_cached_per_address_list() -> None:
    from canccu_kit.access import parsed_cidrs

    parsed_cidrs.cache_clear()
    first = parsed_cidrs(("192.0.2.0/24", "bad"))
    assert parsed_cidrs(("192.0.2.0/24", "bad")) is first
    assert parsed_cidrs.cache_info().hits == 1
    # A venue revision with other addresses is parsed anew; the answers stay right.
    assert ip_in_cidrs("198.51.100.7", ["198.51.100.0/24"])
    assert not ip_in_cidrs("198.51.100.7", ["192.0.2.0/24", "bad"])
    assert parsed_cidrs.cache_info().currsize >= 2


def test_tailscale_prefixes_are_read_once_per_value() -> None:
    env = {"CANCCU_TAILSCALE_CIDRS": "100.100.0.0/16"}
    assert tailscale_cidrs(env) == tailscale_cidrs(env) == ["100.100.0.0/16"]
    from canccu_kit.access import parsed_cidrs

    before = parsed_cidrs.cache_info().misses
    for _ in range(3):
        ip_in_cidrs("100.100.1.1", tailscale_cidrs(env))
    assert parsed_cidrs.cache_info().misses <= before + 1


def test_parse_time_reads_z_and_a_time_without_a_zone_as_utc() -> None:
    from canccu_kit import parse_time

    assert parse_time("2026-11-14T17:00:00Z") == datetime(2026, 11, 14, 17, tzinfo=UTC)
    assert parse_time("2026-11-14T17:00:00") == datetime(2026, 11, 14, 17, tzinfo=UTC)
    assert parse_time("2026-11-14T19:00:00+02:00") == datetime(2026, 11, 14, 17, tzinfo=UTC)
