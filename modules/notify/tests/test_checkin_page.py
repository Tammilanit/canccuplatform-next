"""The check-in page a scanned QR opens (contracts/notify.md, Check-in by the rotating QR;
docs/plans/issue-188.md, area M and Q2)."""

from __future__ import annotations

from datetime import timedelta
from urllib.parse import quote

import httpx
import pytest
from conftest import DOWN_HOST, NOW, Env
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
    assert "optional" in r.text and "scan the screen again" in r.text and recorded(env) == []
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
    assert outsider.status_code == 403 and "join link" in outsider.text
    assert "/notify/join" not in outsider.text  # the hub's join page does not exist yet
    assert recorded(env) == []


async def test_an_archived_event_says_it_has_ended(env: Env) -> None:
    form = {"p": "arrival", "c": (await code(env))["code"]}
    env.contexts["ev-a"]["status"] = "archived"
    r = await submit(env, form, "u_a")
    assert r.status_code == 409 and "has ended" in r.text and recorded(env) == []


async def test_a_cross_site_submit_is_refused(env: Env) -> None:
    form = {"p": "arrival", "c": (await code(env))["code"]}
    async with env.client() as c:
        r = await c.post(
            "/check-in",
            data=form,
            headers={**env.rights.sign_in("u_a"), "origin": "https://evil.example"},
        )
    assert r.status_code == 403 and recorded(env) == []


@pytest.mark.parametrize(
    ("host", "status"),
    [(DOWN_HOST, 503), ("unknown.example.test", 404)],
)
async def test_the_page_says_try_again_when_the_event_cannot_be_resolved(
    env: Env, host: str, status: int
) -> None:
    async with env.client(host) as c:
        r = await c.get("/check-in?p=arrival&c=" + "x" * 22)
    assert r.status_code == status and r.headers["content-type"].startswith("text/html")
    assert "Try again" in r.text and '"error"' not in r.text


async def test_the_page_says_try_again_while_admin_is_down(env: Env) -> None:
    form = {"p": "arrival", "c": (await code(env))["code"]}
    env.settings.down = True
    r = await submit(env, form, "u_a")
    assert r.status_code == 503 and r.headers["content-type"].startswith("text/html")
    assert "Try again" in r.text and recorded(env) == []
    assert r.headers["cache-control"] == "no-store"


async def test_a_refused_origin_is_a_page_too(env: Env) -> None:
    async with env.client() as c:
        r = await c.post(
            "/check-in",
            data={"p": "arrival", "c": "x" * 22},
            headers={**env.rights.sign_in("u_a"), "origin": "https://evil.example"},
        )
    assert r.status_code == 403 and r.headers["content-type"].startswith("text/html")
    assert "Try again" in r.text
