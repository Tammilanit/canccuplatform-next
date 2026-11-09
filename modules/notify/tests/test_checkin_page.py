"""The check-in page a scanned QR opens (contracts/notify.md, Check-in by the rotating QR;
docs/plans/issue-188.md, area M and Q2)."""

from __future__ import annotations

from datetime import timedelta
from urllib.parse import quote

import httpx
import pytest
from conftest import NOW, Env
from test_checkin import code, recorded

from canccu_notify import checkin


async def page(env: Env, query: str, user: str | None = None) -> httpx.Response:
    headers = env.rights.sign_in(user) if user else {}
    async with env.client() as c:
        return await c.get(f"/check-in?{query}", headers=headers)


async def submit(env: Env, form: dict[str, str], user: str | None = None) -> httpx.Response:
    headers = env.rights.sign_in(user) if user else {}
    async with env.client() as c:
        return await c.post("/check-in", data=form, headers=headers)


async def test_signed_out_it_offers_sign_in_and_comes_back(env: Env) -> None:
    shown = (await code(env))["code"]
    query = f"p=arrival&c={shown}"
    r = await page(env, query)
    assert r.status_code == 200
    back = quote(f"/notify/check-in?{query}", safe="")
    assert f'href="/admin/sign-in?next={back}"' in r.text
    assert "optional" in r.text and recorded(env) == []
    csp = r.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in csp and "script-src 'self'" in csp
    assert r.headers["cache-control"] == "no-store"


async def test_signed_in_it_asks_before_checking_in(env: Env) -> None:
    shown = (await code(env))["code"]
    r = await page(env, f"p=arrival&c={shown}", "u_a")
    assert r.status_code == 200 and recorded(env) == []
    assert 'action="/notify/check-in"' in r.text and f'value="{shown}"' in r.text


async def test_checking_in_and_again(env: Env) -> None:
    form = {"p": "arrival", "c": (await code(env))["code"]}
    first = await submit(env, form, "u_a")
    assert first.status_code == 201 and "checked in" in first.text
    again = await submit(env, form, "u_a")
    assert again.status_code == 200 and "already checked in" in again.text
    assert "17:00" in again.text  # in the event's time zone (UTC in the fixture)
    assert len(recorded(env)) == 1


async def test_an_expired_or_wrong_code_says_scan_again(env: Env) -> None:
    form = {"p": "arrival", "c": (await code(env))["code"]}
    env.clock[0] = NOW + timedelta(minutes=2)
    expired = await submit(env, form, "u_a")
    assert expired.status_code == 400 and "Scan the screen again" in expired.text
    wrong = await submit(env, {"p": "arrival", "c": "A" * 22}, "u_a")
    assert wrong.status_code == 400 and "not valid" in wrong.text
    malformed = await page(env, "p=../x&c=1", "u_a")
    assert malformed.status_code == 400 and "not valid" in malformed.text
    assert recorded(env) == []


async def test_a_signed_out_submit_and_a_non_member_are_told_what_to_do(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    form = {"p": "arrival", "c": (await code(env))["code"]}
    signed_out = await submit(env, form)
    assert signed_out.status_code == 401 and "/admin/sign-in?next=" in signed_out.text
    monkeypatch.setattr(checkin, "is_member", lambda session: False)
    outsider = await submit(env, form, "u_a")
    assert outsider.status_code == 403 and 'href="/notify/join"' in outsider.text
    assert recorded(env) == []


async def test_a_cross_site_submit_is_refused(env: Env) -> None:
    form = {"p": "arrival", "c": (await code(env))["code"]}
    async with env.client() as c:
        r = await c.post(
            "/check-in",
            data=form,
            headers={**env.rights.sign_in("u_a"), "origin": "https://evil.example"},
        )
    assert r.status_code == 403 and recorded(env) == []
