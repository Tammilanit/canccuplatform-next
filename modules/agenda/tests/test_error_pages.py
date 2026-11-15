"""The run of show's error pages (#556): every error of a page path is a page, its retry is a GET
with its query, and after a form post it offers the way back instead."""

from __future__ import annotations

import httpx
import pytest
from conftest import Env, at
from test_items import add

from canccu_agenda import posts


async def test_a_mistyped_page_address_draws_the_not_found_page(env: Env) -> None:
    async with env.client() as c:
        r = await c.get("/itemz", headers=env.writer())
        api = await c.get("/api/agenda/nope", headers=env.writer())
    assert r.status_code == 404 and 'canccu-error__title">Not found' in r.text
    assert 'href="/agenda/">Back to the run of show</a>' in r.text
    assert api.status_code == 404 and api.json()["error"]["code"] == "not_found"


async def test_a_failed_page_retries_its_get_with_the_query(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(*args: object) -> None:
        raise RuntimeError("secret detail")

    monkeypatch.setattr(posts, "last", broken)
    transport = httpx.ASGITransport(app=env.app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://a.example.test") as c:
        r = await c.get("/", params={"day": "2026-11-20", "earlier": "1"}, headers=env.writer())
    assert r.status_code == 500 and 'canccu-error__title">Something went wrong' in r.text
    assert 'href="/agenda/?day=2026-11-20&amp;earlier=1">' in r.text
    assert "Try again</a>" in r.text and "secret detail" not in r.text


async def test_a_failed_post_offers_the_way_back_not_a_retry(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        item = await add(c, h, starts_at=at(30))
        env.settings.down = True
        data = {"revision": str(item["revision"])}
        r = await c.post(f"/items/{item['id']}/cancel", data=data, headers=h)
    assert r.status_code == 503 and 'canccu-error__title">Something went wrong' in r.text
    assert "Try again</a>" not in r.text
    assert 'href="/agenda/">Back to the run of show</a>' in r.text
