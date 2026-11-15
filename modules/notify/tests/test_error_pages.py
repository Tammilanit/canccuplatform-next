"""Notify's organiser error pages (#556): every error of a page path is a page, its retry is a
GET with its query, and after a form post it offers the way back instead."""

from __future__ import annotations

import httpx
import pytest
from conftest import Env
from topics import schedule

from canccu_notify import topic_pages

LIST = "/admin/topics"


async def test_a_mistyped_page_address_draws_the_not_found_page(env: Env) -> None:
    async with env.client() as c:
        r = await c.get("/admin/topicz", headers=env.admin())
        api = await c.get("/api/notify/nope", headers=env.admin())
    assert r.status_code == 404 and 'canccu-error__title">Not found' in r.text
    assert api.status_code == 404 and api.json()["error"]["code"] == "not_found"


def _broken(env: Env, monkeypatch: pytest.MonkeyPatch) -> httpx.AsyncClient:
    async def broken(*args: object) -> None:
        raise RuntimeError("secret detail")

    monkeypatch.setattr(topic_pages, "configured", broken)
    transport = httpx.ASGITransport(app=env.app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="http://a.example.test")


async def test_a_failed_page_retries_its_get_with_the_query(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with _broken(env, monkeypatch) as c:
        r = await c.get(LIST, params={"saved": "1"}, headers=env.admin())
    assert r.status_code == 500 and 'canccu-error__title">Something went wrong' in r.text
    assert 'href="/notify/admin/topics?saved=1">' in r.text and "Try again</a>" in r.text
    assert "secret detail" not in r.text


async def test_a_failed_post_offers_the_way_back_not_a_retry(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    await env.register(schedule())
    async with _broken(env, monkeypatch) as c:
        r = await c.post(f"{LIST}/schedule", data={"config_version": "0"}, headers=env.admin())
    assert r.status_code == 500 and "Try again</a>" not in r.text
    assert 'href="/notify/admin/topics">Back to Notifications</a>' in r.text
