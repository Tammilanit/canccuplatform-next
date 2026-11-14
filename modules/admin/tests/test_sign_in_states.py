"""The sign-in page's states and the pages around it (docs/design/mockups.html, sheets 3 and 8;
#440): no role yet, an archived event, not set up, signed out, offline."""

from __future__ import annotations

import html
import json
import re
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from conftest import START, World, owner_and_member

from canccu_admin.auth import IDLE


async def test_signed_in_without_a_role_lands_on_no_role_yet(world: World) -> None:
    r = await world.sign_in("2002", "Aino")
    page = await world.client.get(r.headers["location"], follow_redirects=True)
    assert page.status_code == 200 and str(page.url).endswith("/admin/sign-in")
    assert "No role yet" in page.text
    assert "You're signed in as Aino, but you have no role in Demo Event yet." in html.unescape(
        page.text
    )
    assert "They now see you under People." in page.text
    assert 'href="/admin/">Check again</a>' in page.text
    assert 'action="/admin/sign-out"' in page.text and "Sign in as someone else" in page.text
    assert "Continue with Discord" not in page.text


async def test_a_page_sends_someone_without_a_role_to_no_role_yet(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    _, member = await owner_and_member(world, caplog)
    for path in ("/admin/settings", "/admin/people", "/admin/profile"):
        r = await world.browser(member).get(path)
        assert r.status_code == 303 and r.headers["location"] == "/admin/sign-in", path


async def test_check_again_lets_them_in_once_they_have_a_role(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    _, member = await owner_and_member(world, caplog)
    aino = next(u for u, _ in await world.store.list_users() if u.name == "Aino")
    await world.auth.set_role(aino.id, "admin", "u_owner")
    r = await world.browser(member).get("/admin/")
    assert r.status_code == 303 and r.headers["location"] == "/admin/settings"
    # Signed in with a role, the sign-in page has nothing to offer: on to the pages.
    r = await world.browser(member).get("/admin/sign-in")
    assert r.status_code == 303 and r.headers["location"] == "/admin/"


async def test_a_return_path_wins_over_no_role_yet(world: World) -> None:
    """An attendee signed in for check-in has no role, and must never see the organisers' card."""
    await world.sign_in("2002", "Aino")
    r = await world.client.get("/admin/sign-in", params={"next": "/notify/check-in?p=arrival"})
    assert r.status_code == 303 and r.headers["location"] == "/notify/check-in?p=arrival"


async def test_a_cancelled_sign_in_from_another_module_says_so(world: World) -> None:
    """Agenda sends a signed-out browser back to sign in with its own address as `next`, so a
    cancelled flow's marker reaches the organisers' card there; it says so and drops the marker."""
    start = await world.client.post("/admin/sign-in", data={"next": "/agenda/?day=2"})
    state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    back = await world.client.get(
        "/admin/sign-in/callback", params={"error": "access_denied", "state": state}
    )
    assert back.headers["location"] == "/agenda/?day=2&signin=cancelled"
    page = await world.client.get("/admin/sign-in", params={"next": back.headers["location"]})
    text = html.unescape(page.text)
    assert page.status_code == 200 and "Discord was closed before it said yes." in text
    assert '<input type=hidden name=next value="/agenda/?day=2">' in text
    assert "signin=cancelled" not in text


async def test_an_archived_event_offers_to_look_back(world: World) -> None:
    world.event["status"] = "archived"
    page = await world.client.get("/admin/sign-in")
    assert "Sign in to look back" in page.text
    assert "The event is over. Sign in to read its run of show and settings;" in page.text
    assert "Sign in to run the event" not in page.text and "No role yet?" not in page.text
    assert "Continue with Discord" in page.text


async def test_not_set_up_offers_check_again_and_what_to_tell(world: World) -> None:
    world.auth.discord = None
    page = await world.client.get("/admin/sign-in")
    assert "Sign-in isn't switched on yet" in html.unescape(page.text)
    assert 'href="/admin/sign-in">Check again</a>' in page.text
    assert "Running the event today? Tell them: “Discord sign-in is not set up”." in page.text
    assert "Continue with Discord" not in page.text


async def test_an_archived_event_says_so_while_sign_in_is_not_set_up(world: World) -> None:
    world.auth.discord = None
    world.event["status"] = "archived"
    page = html.unescape((await world.client.get("/admin/sign-in")).text)
    assert "Sign in to look back" in page and "Sign-in isn't switched on yet" in page


@pytest.mark.parametrize("how", ["expired", "unknown"])
async def test_a_session_that_ended_says_you_were_signed_out(world: World, how: str) -> None:
    if how == "expired":
        await world.sign_in("2002", "Aino")
        cookie = world.client.cookies["canccu_session"]
        world.clock[0] = START + IDLE + timedelta(seconds=1)
    else:
        cookie = "made-up"
    r = await world.browser(cookie).get("/admin/sign-in")
    assert r.status_code == 200 and "You were signed out" in r.text
    assert "Nothing you saved is lost." in r.text
    assert 'href="/admin/sign-in">Sign in again</a>' in r.text
    # Said once: the cookie goes, so "Sign in again" opens the sign-in card.
    assert 'canccu_session=""' in r.headers["set-cookie"]


async def test_signed_out_keeps_the_return_path(world: World) -> None:
    r = await world.browser("made-up").get("/admin/sign-in", params={"next": "/agenda/"})
    assert 'href="/admin/sign-in?next=%2Fagenda%2F">Sign in again</a>' in r.text


async def test_sign_out_clears_the_offline_copy(world: World) -> None:
    """The offline page is kept with the shell of whoever was signed in (sw.js), in Cache Storage,
    which Clear-Site-Data's "storage" empties ("cache" is only the HTTP cache): on a shared phone
    the next person must not see the last one's name and menu."""
    sw = (await world.client.get("/admin/static/sw.js")).text
    assert "caches.open(" in sw
    await world.sign_in("2002", "Aino")
    r = await world.client.post("/admin/sign-out")
    directives = {d.strip() for d in r.headers["clear-site-data"].split(",")}
    assert directives == {'"cache"', '"storage"'}


async def test_the_offline_page_keeps_the_shell(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    page = await world.browser(owner).get("/admin/offline")
    assert page.status_code == 200
    assert "You're offline" in html.unescape(page.text)
    assert "It loads by itself when you're back online." in html.unescape(page.text)
    assert "canccu-error--warn" in page.text  # amber: not a fault of the platform
    assert 'class="canccu-tabbar"' in page.text and "aria-current" not in page.text
    assert "data-canccu-offline" in page.text
    signed_out = await world.browser().get("/admin/offline")
    assert signed_out.status_code == 200 and 'class="canccu-tabbar"' not in signed_out.text


async def test_the_service_worker_may_serve_every_organiser_page(world: World) -> None:
    r = await world.client.get("/admin/static/sw.js")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/javascript")
    assert r.headers["service-worker-allowed"] == "/"
    assert "/admin/offline" in r.text
    shell = await world.client.get("/admin/static/shell.js")
    assert shell.status_code == 200 and "serviceWorker" in shell.text


async def test_the_service_worker_keeps_what_the_offline_page_links(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    """Offline, the page's stylesheet and script come from the worker's cache or not at all: the
    HTTP cache's copy is gone after max-age or sign-out (sw.js, ASSETS)."""
    owner, _ = await owner_and_member(world, caplog)
    page = await world.browser(owner).get("/admin/offline")
    links = re.findall(r'<link rel="stylesheet" href="([^"]+)"|<script src="([^"]+)"', page.text)
    linked = {css or script for css, script in links}
    worker = (await world.client.get("/admin/static/sw.js")).text
    found = re.search(r"const ASSETS = (\[[^\]]*\]);", worker)
    assert found is not None
    kept = set(json.loads(found.group(1)))
    assert kept == {"/admin/static/ui.css", "/admin/static/shell.js"}
    # The event's look is kept too, when the event answers it (#432), outside the all or nothing.
    look = re.search(r'const LOOK = "([^"]+)";', worker)
    assert look is not None and look.group(1) == "/theming/current/admin-tokens.css"
    assert linked == kept | {look.group(1)}
    for url in kept:  # the worker keeps nothing unless every one of them answers
        assert (await world.client.get(url)).status_code == 200


async def test_the_sign_in_page_carries_the_privacy_tag(world: World) -> None:
    page = await world.client.get("/admin/sign-in")
    assert page.text.endswith(
        '<a class="canccu-privacy-link" href="/notify/privacy">Privacy</a></body></html>'
    )
