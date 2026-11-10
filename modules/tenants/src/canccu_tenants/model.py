"""Shapes of contracts/tenants.openapi.yaml built from rows, and the input checks they share."""

from __future__ import annotations

import ipaddress
import json
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from canccu_kit import KitError, TenantContext
from canccu_kit.tenant import is_tenant_id
from starlette.requests import Request

HOSTNAME_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
INFO_MODES = ("public", "venue_only", "sign_in")
MEMBERSHIP = ("open", "closed")
ADMIN_ACCESS = ("restricted", "internet")
TRANSITIONS = {("draft", "live"), ("live", "archived"), ("draft", "archived")}


def bad_request(message: str) -> KitError:
    return KitError(message, status=400, code="invalid_request")


def conflict(code: str, message: str | None = None) -> KitError:
    return KitError(message, status=409, code=code)


def not_found() -> KitError:
    return KitError("Not found.", status=404, code="not_found")


async def body_of(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except ValueError as exc:
        raise bad_request("the body must be JSON") from exc
    if not isinstance(body, dict):
        raise bad_request("the body must be a JSON object")
    return body


def iso(value: datetime | None) -> str | None:
    return None if value is None else value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def parse_time(value: object, field: str) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise bad_request(f"{field} must be a date-time")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise bad_request(f"{field} must be a date-time") from exc
    if parsed.tzinfo is None:
        raise bad_request(f"{field} needs a time zone offset")
    return parsed


def check_time_zone(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise bad_request("time_zone must be an IANA zone")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise bad_request("time_zone must be an IANA zone") from exc
    return value


def check_name(value: object, field: str = "name") -> str:
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 120:
        raise bad_request(f"{field} must be 1-120 characters")
    return value.strip()


def check_choice(value: object, choices: tuple[str, ...], field: str) -> str:
    if value not in choices:
        raise bad_request(f"{field} must be one of {', '.join(choices)}")
    return str(value)


def check_tenant_id(value: object) -> str:
    # The kit's rule (keys, streams, paths) plus the contract's 3-32 characters.
    if not isinstance(value, str) or not is_tenant_id(value) or not 3 <= len(value) <= 32:
        raise bad_request("id: lowercase letters, digits and -, 3-32 characters, from a letter")
    return value


def check_id(value: object, field: str) -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise bad_request(f"{field} is not a valid id")
    return value


MAX_STORAGE_BYTES = 1_099_511_627_776
"""The largest quota and count (contracts, `StorageQuota`): 1 TiB."""


def check_storage_bytes(value: object, field: str, low: int = 0) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not low <= value <= MAX_STORAGE_BYTES
    ):
        raise bad_request(f"{field}: a whole number from {low} to {MAX_STORAGE_BYTES}")
    return value


def check_revision(body: Mapping[str, Any], field: str = "revision") -> int:
    value = body.get(field)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise bad_request(f"{field} is required")
    return value


def check_addresses(value: object) -> list[str]:
    if not isinstance(value, list) or len(value) > 20:
        raise bad_request("addresses: a list of at most 20 CIDR prefixes")
    out = []
    for item in value:
        try:
            out.append(str(ipaddress.ip_network(str(item), strict=False)))
        except ValueError as exc:
            raise bad_request(f"addresses: {item!r} is not an address or CIDR prefix") from exc
    return out


def _wifi(item: object) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise bad_request("wifi: each network is an object")
    ssid, password, note = item.get("ssid"), item.get("password"), item.get("note")
    if not isinstance(ssid, str) or not 1 <= len(ssid) <= 32:
        raise bad_request("wifi.ssid must be 1-32 characters")
    if password is not None and not (
        isinstance(password, str)
        and (8 <= len(password) <= 63 or re.fullmatch(r"[0-9A-Fa-f]{64}", password))
    ):
        raise bad_request("wifi.password: 8-63 characters, or a 64-hex-digit key")
    if note is not None and (not isinstance(note, str) or len(note) > 500):
        raise bad_request("wifi.note: at most 500 characters")
    visibility = check_choice(item.get("visibility"), ("public", "attendees"), "wifi.visibility")
    return {"ssid": ssid, "password": password, "note": note, "visibility": visibility}


def check_profile(body: Mapping[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    rules, wifi = body.get("house_rules"), body.get("wifi")
    if not isinstance(rules, str) or len(rules) > 20_000:
        raise bad_request("house_rules: text of at most 20,000 characters")
    if not isinstance(wifi, list) or len(wifi) > 10:
        raise bad_request("wifi: a list of at most 10 networks")
    return rules, [_wifi(w) for w in wifi]


def floor_plan(row: Mapping[str, Any]) -> dict[str, Any] | None:
    if row["floor_plan_type"] is None:
        return None
    return {"content_type": row["floor_plan_type"], "updated_at": iso(row["floor_plan_updated_at"])}


def wifi_of(row: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw = row["wifi"]
    return list(json.loads(raw) if isinstance(raw, str) else raw)


def venue_ref(row: Mapping[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "addresses": list(row["addresses"])}


def venue(row: Mapping[str, Any]) -> dict[str, Any]:
    profile = {
        "house_rules": row["house_rules"],
        "wifi": wifi_of(row),
        "floor_plan": floor_plan(row),
    }
    return venue_ref(row) | {"profile": profile, "revision": row["revision"]}


def ip_check(row: Mapping[str, Any], now: datetime) -> dict[str, Any]:
    # Due once `disabled_until` has passed, even before the timer writes it back (plan D8).
    until = row["ip_check_disabled_until"]
    if until is None or until <= now:
        return {"enabled": True, "disabled_until": None, "reason": None}
    return {"enabled": False, "disabled_until": iso(until), "reason": row["ip_check_reason"]}


def public_tenant(row: Mapping[str, Any], primary: str | None) -> dict[str, Any]:
    venue_ = None if row["venue_id"] is None else {"id": row["venue_id"], "name": row["venue_name"]}
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "time_zone": row["time_zone"],
        "starts_at": iso(row["starts_at"]),
        "ends_at": iso(row["ends_at"]),
        "venue": venue_,
        "primary_hostname": primary,
        "info_page_mode": row["info_page_mode"],
        "membership": row["membership"],
    }


def tenant(row: Mapping[str, Any], primary: str | None, now: datetime) -> dict[str, Any]:
    return public_tenant(row, primary) | {
        "series_id": row["series_id"],
        "storage_quota_bytes": row["storage_quota_bytes"],
        "admin_access": row["admin_access"],
        "venue_ip_check": ip_check(row, now),
        "archived_at": iso(row["archived_at"]),
        "presence_delete_at": iso(row["presence_delete_at"]),
        "cloned_from": row["cloned_from"],
        "created_at": iso(row["created_at"]),
        "revision": row["revision"],
    }


def context(
    row: Mapping[str, Any], primary: str | None, flags: dict[str, bool], now: datetime
) -> TenantContext:
    venue_ = None
    if row["venue_id"] is not None:
        venue_ = {
            "id": row["venue_id"],
            "name": row["venue_name"],
            "addresses": list(row["venue_addresses"]),
        }
    return {
        "tenant_id": row["id"],
        "status": row["status"],
        "primary_hostname": primary,
        "time_zone": row["time_zone"],
        "info_page_mode": row["info_page_mode"],
        "membership": row["membership"],
        "admin_access": row["admin_access"],
        "venue": venue_,  # type: ignore[typeddict-item]
        "venue_ip_check": ip_check(row, now),  # type: ignore[typeddict-item]
        "flags_version": row["flags_version"],
        "flags": flags,
    }


def hostname(row: Mapping[str, Any]) -> dict[str, Any]:
    verification = None
    if row["status"] == "pending" and row["verify_token"]:
        verification = {
            "txt_name": f"_canccu-verify.{row['hostname']}",
            "txt_value": row["verify_token"],
        }
    return {
        "hostname": row["hostname"],
        "tenant_id": row["tenant_id"],
        "kind": row["kind"],
        "status": row["status"],
        "primary": row["is_primary"],
        "verification": verification,
        "held_until": iso(row["held_until"]),
    }
