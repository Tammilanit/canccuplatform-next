"""Admin's error pages (#556): every error of a page path is a page in the shell, its retry is a
GET with its query, and its way back fits the page and the session's rights."""

from __future__ import annotations

import httpx
import pytest
from canccu_kit import NotSignedIn
from canccu_kit.rights import Session
from conftest import World, owner_and_member


async def test_a_mistyped_page_address_draws_the_not_found_page(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).get("/admin/settingz")
    assert r.status_code == 404 and 'canccu-error__title">Not found' in r.text
    assert "canccu-menu" in r.text  # in the shell of the session it has
    api = await world.browser(owner).get("/api/admin/nope")
    assert api.status_code == 404 and api.json()["error"]["code"] == "not_found"


async def test_the_error_page_reads_the_session_as_the_pages_do(
    world: World, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A session only the rights checker answers for, as with CI's session stub: the error page
    # still draws its shell, as every other page of that session does.
    owner, _ = await owner_and_member(world, caplog)
    assert (await world.browser(owner).get("/admin/settings")).status_code == 200

    async def unknown(session_id: str | None) -> Session:
        raise NotSignedIn("sign in first")

    monkeypatch.setattr(world.auth, "session", unknown)
    r = await world.browser(owner).get("/admin/settingz")
    assert r.status_code == 404 and "canccu-menu" in r.text
    assert 'href="/admin/sign-in">Sign in</a>' not in r.text


async def test_signed_out_a_mistyped_address_offers_sign_in(world: World) -> None:
    r = await world.browser().get("/admin/settingz")
    assert r.status_code == 404 and 'canccu-error__title">Not found' in r.text
    assert 'href="/admin/sign-in">Sign in</a>' in r.text


async def test_a_wrong_method_on_a_page_is_a_page(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).post("/admin/health-view")
    assert r.status_code == 405 and "canccu-error" in r.text
    assert set(r.headers["allow"].split(", ")) == {"GET", "HEAD"}


async def test_a_failed_page_retries_its_get_with_the_query(
    world: World, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, _ = await owner_and_member(world, caplog)

    async def broken() -> None:
        raise RuntimeError("secret detail")

    monkeypatch.setattr(world.service.store, "last_changed", broken)
    browser = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=world.client._transport.app, raise_app_exceptions=False),  # type: ignore[attr-defined]
        base_url=str(world.client.base_url),
        cookies={"canccu_session": owner},
    )
    r = await browser.get("/admin/settings?from=menu")
    assert r.status_code == 500 and 'canccu-error__title">Something went wrong' in r.text
    assert 'href="/admin/settings?from=menu">' in r.text and "Try again</a>" in r.text
    assert "secret detail" not in r.text


async def test_a_refused_post_on_people_goes_back_to_people_not_a_retry(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, member = await owner_and_member(world, caplog)
    who = (await world.auth.session(member)).user_id
    r = await world.browser(owner).post(f"/admin/people/{who}", data={"role": "bogus"})
    assert r.status_code == 400 and 'canccu-error__title">Couldn' in r.text
    assert 'href="/admin/people">Back to People</a>' in r.text
    assert "Back to Settings" not in r.text and "Try again</a>" not in r.text
