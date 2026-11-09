"""Rotating check-in codes and check-ins (contracts/notify.md, Check-in by the rotating QR)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import timedelta
from typing import Any

import httpx
import pytest
from canccu_kit import ServiceIdentity
from conftest import KEY, NOW, Env

from canccu_notify import checkin

DISPLAY = "notify.checkin.display"
PERIOD = int(NOW.timestamp()) // 30


async def code(env: Env, purpose: str = "arrival", host: str = "a.example.test") -> Any:
    async with env.client(host) as c:
        r = await c.get(
            "/api/notify/check-in/code",
            params={"purpose": purpose},
            headers=env.rights.sign_in("u_door", DISPLAY),
        )
    assert r.status_code == 200, r.text
    return r.json()


async def check_in(
    env: Env, user: str, body: dict[str, Any], host: str = "a.example.test"
) -> httpx.Response:
    async with env.client(host) as c:
        return await c.post("/api/notify/check-ins", json=body, headers=env.rights.sign_in(user))


def recorded(env: Env, tenant: str = "ev-a") -> list[Any]:
    entries = env.store.streams.get(f"t:{tenant}:events:notify", [])
    return [json.loads(fields["event"]) for _, fields in entries]


async def test_the_code_needs_the_display_right(env: Env) -> None:
    async with env.client() as c:
        url = "/api/notify/check-in/code?purpose=arrival"
        assert (await c.get(url)).status_code == 401
        missing = await c.get(url, headers=env.rights.sign_in("u_a"))
        assert missing.status_code == 403 and missing.json()["error"]["code"] == "missing_right"
        bad = await c.get(
            "/api/notify/check-in/code?purpose=Arrival",
            headers=env.rights.sign_in("u_door", DISPLAY),
        )
        assert bad.status_code == 400


async def test_the_code_is_hmac_over_event_purpose_and_period(env: Env) -> None:
    now = await code(env)
    assert now["purpose"] == "arrival" and len(now["code"]) == 22
    assert now["rotates_at"] == "2026-11-20T17:00:30Z"
    assert now["valid_until"] == "2026-11-20T17:01:00Z"
    # The key is stored sealed, never in clear, and the code follows the contract's formula.
    async with env.db.tenant("ev-a") as conn:
        sealed = await conn.fetchval("SELECT sealed FROM notify_check_in_keys")
    assert sealed.startswith("cs1.")
    key = env.deps.secrets.open(sealed, "notify:checkin:ev-a")
    mac = hmac.new(key, f"ev-a\narrival\n{PERIOD}".encode(), hashlib.sha256).digest()
    assert now["code"] == base64.urlsafe_b64encode(mac[:16]).rstrip(b"=").decode()
    # Stable within its period; another purpose, event or period has another code.
    assert (await code(env))["code"] == now["code"]
    assert (await code(env, "tournament:s_12"))["code"] != now["code"]
    assert (await code(env, host="b.example.test"))["code"] != now["code"]
    env.clock[0] = NOW + timedelta(seconds=30)
    assert (await code(env))["code"] != now["code"]


async def test_the_url_uses_the_primary_hostname(env: Env) -> None:
    relative = await code(env, "tournament:s_12")
    assert relative["url"] == f"/notify/check-in?p=tournament%3As_12&c={relative['code']}"
    env.contexts["ev-a"]["primary_hostname"] = "party.example.test"
    absolute = await code(env)
    assert absolute["url"] == (
        f"https://party.example.test/notify/check-in?p=arrival&c={absolute['code']}"
    )


async def test_the_rotation_follows_the_events_setting(env: Env) -> None:
    env.settings.values["ev-a"] = {"check_in_rotation_seconds": 60}
    first = await code(env)
    assert first["rotates_at"] == "2026-11-20T17:01:00Z"
    env.clock[0] = NOW + timedelta(seconds=45)
    assert (await code(env))["code"] == first["code"]


async def test_the_screen_module_fetches_the_code_internally(env: Env) -> None:
    public = await code(env)
    screen = ServiceIdentity("screen", KEY)
    async with env.internal() as c:
        url = "/internal/notify/check-in/code"
        params = {"tenant_id": "ev-a", "purpose": "arrival"}
        ok = await c.get(url, params=params, headers=screen.headers("notify"))
        assert ok.status_code == 200 and ok.json() == public
        assert (await c.get(url, params=params)).status_code == 401
        unknown = {"tenant_id": "ev-gone", "purpose": "arrival"}
        missing = await c.get(url, params=unknown, headers=screen.headers("notify"))
        assert missing.status_code == 404
        malformed = {"tenant_id": "ev-a", "purpose": "no spaces"}
        bad = await c.get(url, params=malformed, headers=screen.headers("notify"))
        assert bad.status_code == 400


async def test_checking_in_once_per_purpose(env: Env) -> None:
    now = await code(env)
    first = await check_in(env, "u_a", {"purpose": "arrival", "code": now["code"]})
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["purpose"] == "arrival" and body["checked_in_at"] == "2026-11-20T17:00:00Z"
    env.clock[0] = NOW + timedelta(minutes=5)
    again = await check_in(env, "u_a", {"purpose": "arrival", "code": (await code(env))["code"]})
    assert again.status_code == 200 and again.json() == body
    [event] = recorded(env)
    assert event["type"] == "notify.checkin.recorded" and event["tenant"] == "ev-a"
    assert event["data"] == {
        "user_id": "u_a",
        "purpose": "arrival",
        "check_in_id": body["id"],
        "checked_in_at": body["checked_in_at"],
    }


@pytest.mark.parametrize(
    ("seconds_later", "status", "error"),
    [
        (29, 201, None),  # same period
        (30, 201, None),  # the next period: the previous one is still valid
        (60, 400, "code_expired"),
        (30 * 11, 400, "code_expired"),
        (30 * 12, 400, "code_invalid"),
    ],
)
async def test_a_code_is_valid_for_two_periods_then_expires(
    env: Env, seconds_later: int, status: int, error: str | None
) -> None:
    shown = (await code(env))["code"]
    env.clock[0] = NOW + timedelta(seconds=seconds_later)
    r = await check_in(env, "u_a", {"purpose": "arrival", "code": shown})
    assert r.status_code == status, r.text
    if error is not None:
        assert r.json()["error"]["code"] == error and recorded(env) == []


async def test_codes_of_another_event_or_purpose_are_invalid(env: Env) -> None:
    before_any_key = await check_in(env, "u_a", {"purpose": "arrival", "code": "A" * 22})
    assert before_any_key.json()["error"]["code"] == "code_invalid"
    other_event = (await code(env, host="b.example.test"))["code"]
    other_purpose = (await code(env, "tournament:s_12"))["code"]
    for wrong in (other_event, other_purpose, "A" * 22):
        r = await check_in(env, "u_a", {"purpose": "arrival", "code": wrong})
        assert r.status_code == 400 and r.json()["error"]["code"] == "code_invalid"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"purpose": "arrival"},
        {"purpose": "arrival", "code": "short"},
        {"purpose": 1, "code": 2},
    ],
)
async def test_a_malformed_check_in_is_refused(env: Env, body: dict[str, Any]) -> None:
    r = await check_in(env, "u_a", body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_request"


async def test_checking_in_needs_a_members_session(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    shown = {"purpose": "arrival", "code": (await code(env))["code"]}
    async with env.client() as c:
        r = await c.post("/api/notify/check-ins", json=shown)
    assert r.status_code == 401 and r.json()["error"]["code"] == "not_signed_in"
    monkeypatch.setattr(checkin, "is_member", lambda session: False)
    r = await check_in(env, "u_a", shown)
    assert r.status_code == 403 and r.json()["error"]["code"] == "not_a_member"
    assert recorded(env) == []


async def test_mine_lists_only_the_callers_check_ins_at_this_event(env: Env) -> None:
    await check_in(env, "u_a", {"purpose": "arrival", "code": (await code(env))["code"]})
    await check_in(env, "u_b", {"purpose": "arrival", "code": (await code(env))["code"]})
    b_code = (await code(env, host="b.example.test"))["code"]
    await check_in(env, "u_a", {"purpose": "arrival", "code": b_code}, host="b.example.test")
    async with env.client() as c:
        assert (await c.get("/api/notify/check-ins/mine")).status_code == 401
        r = await c.get("/api/notify/check-ins/mine", headers=env.rights.sign_in("u_a"))
    [mine] = r.json()["check_ins"]
    assert mine["purpose"] == "arrival" and set(mine) == {"id", "purpose", "checked_in_at"}
    assert [e["data"]["user_id"] for e in recorded(env)] == ["u_a", "u_b"]
    assert [e["data"]["user_id"] for e in recorded(env, "ev-b")] == ["u_a"]
