"""First-run code, Discord sign-in and sessions (issue #10)."""

from __future__ import annotations

import json
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from canccu_kit import NotSignedIn
from conftest import CALLBACK, PUBLIC, START, World, first_run_code, owner_and_member

from canccu_admin.auth import ABSOLUTE, IDLE

# --- first-run code


async def test_first_run_code_makes_the_owner(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    code = await first_run_code(world, caplog)
    r = await world.sign_in("1001", "Olli", path="/admin/first-run", data={"code": code.lower()})
    assert r.status_code == 303 and r.headers["location"] == "/admin/"
    session = (await world.client.get("/api/admin/session")).json()
    assert session["user"]["name"] == "Olli"
    assert set(session["rights"]) == {
        "admin.settings.read",
        "admin.settings.write",
        "admin.profile.read",
        "admin.profile.write",
        "admin.rights.write",
    }
    # Used once: no second owner, and no new code while an owner exists.
    world.client.cookies.clear()
    again = await world.client.post("/admin/first-run", data={"code": code})
    assert again.status_code == 409
    assert await world.auth.issue_first_run_code() is None


async def test_wrong_first_run_code_is_refused(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    await first_run_code(world, caplog)
    r = await world.client.post("/admin/first-run", data={"code": "AAAA-BBBB-CCCC"})
    assert r.status_code == 400
    assert "location" not in r.headers


async def test_restart_replaces_the_code(world: World, caplog: pytest.LogCaptureFixture) -> None:
    old = await first_run_code(world, caplog)
    new = await first_run_code(world, caplog)
    assert old != new
    assert (await world.client.post("/admin/first-run", data={"code": old})).status_code == 400
    assert (await world.client.post("/admin/first-run", data={"code": new})).status_code == 303


async def test_code_replaced_during_the_round_trip_does_not_make_an_owner(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    code = await first_run_code(world, caplog)
    start = await world.client.post("/admin/first-run", data={"code": code})
    await world.auth.issue_first_run_code()
    query = parse_qs(urlsplit(start.headers["location"]).query)
    world.discord.users["c"] = {"id": "1001", "username": "Olli"}
    world.discord.challenges["c"] = query["code_challenge"][0]
    r = await world.client.get(CALLBACK, params={"code": "c", "state": query["state"][0]})
    assert r.status_code == 409
    assert not await world.store.has_owner()


# --- Discord sign-in


async def test_authorize_redirect_uses_the_public_url(world: World) -> None:
    r = await world.client.post("/admin/sign-in", headers={"host": "evil.example"})
    location = urlsplit(r.headers["location"])
    query = parse_qs(location.query)
    assert f"{location.scheme}://{location.netloc}{location.path}" == (
        "https://discord.com/oauth2/authorize"
    )
    assert query["redirect_uri"] == [f"{PUBLIC}/admin/sign-in/callback"]
    assert query["scope"] == ["identify"] and query["response_type"] == ["code"]
    assert query["code_challenge_method"] == ["S256"] and query["client_id"] == ["client-1"]
    cookie = r.headers["set-cookie"]
    assert "canccu_sign_in=" in cookie and "HttpOnly" in cookie and "Path=/admin/sign-in" in cookie


async def test_sign_in_sets_a_postgres_session_cookie(world: World) -> None:
    r = await world.sign_in("2002", "Aino")
    cookie = r.headers["set-cookie"]
    for attr in ("canccu_session=", "HttpOnly", "SameSite=lax", "Secure", "Path=/"):
        assert attr in cookie
    assert "Domain" not in cookie
    token = world.client.cookies["canccu_session"]
    assert token not in json.dumps(world.store.sessions, default=str)
    session = (await world.client.get("/api/admin/session")).json()
    assert session["user"]["name"] == "Aino" and session["rights"] == []
    assert session["expires_at"] == (START + IDLE).isoformat().replace("+00:00", "Z")
    form = world.discord.token_requests[0]
    assert form["redirect_uri"] == [f"{PUBLIC}/admin/sign-in/callback"]


async def test_callback_refuses_bad_state(world: World) -> None:
    start = await world.client.post("/admin/sign-in")
    state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    world.discord.users["c"] = {"id": "1", "username": "x"}
    bad = await world.client.get("/admin/sign-in/callback", params={"code": "c", "state": "nope"})
    assert bad.status_code == 400
    assert_flow_cookie_cleared(bad)
    # The flow cookie binds the state to this browser: another browser cannot finish it.
    r = await world.browser().get("/admin/sign-in/callback", params={"code": "c", "state": state})
    assert r.status_code == 400 and "canccu_session" not in r.headers.get("set-cookie", "")


async def test_callback_refuses_an_expired_or_reused_state(world: World) -> None:
    start = await world.client.post("/admin/sign-in")
    query = parse_qs(urlsplit(start.headers["location"]).query)
    world.discord.users["c"] = {"id": "1", "username": "x"}
    world.discord.challenges["c"] = query["code_challenge"][0]
    world.clock[0] = START + timedelta(minutes=11)
    r = await world.client.get(CALLBACK, params={"code": "c", "state": query["state"][0]})
    assert r.status_code == 400
    r = await world.client.get(CALLBACK, params={"code": "c", "state": query["state"][0]})
    assert r.status_code == 400


async def test_callback_reports_a_cancelled_sign_in(world: World) -> None:
    await world.client.post("/admin/sign-in")
    r = await world.client.get("/admin/sign-in/callback", params={"error": "access_denied"})
    assert r.status_code == 400 and "Discord was closed before it said yes." in r.text
    assert "Try again with Discord" in r.text
    assert_flow_cookie_cleared(r)


async def test_failed_token_exchange_clears_the_flow_cookie(world: World) -> None:
    start = await world.client.post("/admin/sign-in")
    state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    r = await world.client.get(CALLBACK, params={"code": "unknown", "state": state})
    assert r.status_code == 502
    assert_flow_cookie_cleared(r)


def assert_flow_cookie_cleared(r: httpx.Response) -> None:
    cookie = r.headers["set-cookie"]
    assert 'canccu_sign_in=""' in cookie and "Max-Age=0" in cookie
    assert "Path=/admin/sign-in" in cookie


async def test_failed_token_exchange_is_a_bad_gateway(world: World) -> None:
    start = await world.client.post("/admin/sign-in")
    state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    r = await world.client.get(CALLBACK, params={"code": "unknown", "state": state})
    assert r.status_code == 502


async def test_signing_in_again_rotates_the_session(world: World) -> None:
    await world.sign_in("2002", "Aino")
    old = world.client.cookies["canccu_session"]
    await world.sign_in("2002", "Aino K")
    assert world.client.cookies["canccu_session"] != old
    assert len(world.store.sessions) == 1
    assert len(world.store.users) == 1
    stale = await world.browser(old).get("/api/admin/session")
    assert stale.status_code == 401


async def test_sign_in_without_discord_config_says_so(world: World) -> None:
    world.auth.discord = None
    page = await world.client.get("/admin/sign-in")
    assert "switched on yet" in page.text and "CANCCU_" not in page.text
    assert (await world.client.post("/admin/sign-in")).status_code == 503


# --- sessions


async def test_sign_out(world: World) -> None:
    await world.sign_in("2002", "Aino")
    token = world.client.cookies["canccu_session"]
    r = await world.client.post("/api/admin/session/sign-out")
    assert r.status_code == 204
    assert 'canccu_session=""' in r.headers["set-cookie"] and "Max-Age=0" in r.headers["set-cookie"]
    r = await world.browser(token).get("/api/admin/session")
    assert r.status_code == 401 and r.json()["error"]["code"] == "not_signed_in"


@pytest.mark.parametrize("cookie", [None, "made-up", "expired"])
async def test_sign_out_api_always_clears_the_cookie(world: World, cookie: str | None) -> None:
    """contracts/admin.md: 204 and the cookie cleared, whatever state the session is in."""
    if cookie == "expired":
        await world.sign_in("2002", "Aino")
        cookie = world.client.cookies["canccu_session"]
        world.clock[0] = START + IDLE + timedelta(seconds=1)
    r = await world.browser(cookie).post("/api/admin/session/sign-out")
    assert r.status_code == 204
    assert 'canccu_session=""' in r.headers["set-cookie"] and "Max-Age=0" in r.headers["set-cookie"]


@pytest.mark.parametrize("how", ["api", "page", "expired", "signed in again"])
async def test_ended_session_leaves_admins_rights_cache_at_once(
    world: World, caplog: pytest.LogCaptureFixture, how: str
) -> None:
    code = await first_run_code(world, caplog)
    await world.sign_in("1001", "Olli", path="/admin/first-run", data={"code": code})
    copied = f"canccu_session={world.client.cookies['canccu_session']}"
    await world.checker.check(copied, "admin.settings.read")  # fills the 30 s cache
    if how == "api":
        assert (await world.client.post("/api/admin/session/sign-out")).status_code == 204
    elif how == "page":
        assert (await world.client.post("/admin/sign-out")).status_code == 303
    elif how == "expired":
        world.clock[0] = START + IDLE + timedelta(seconds=1)
        assert (await world.client.get("/api/admin/session")).status_code == 401
    else:
        await world.sign_in("1001", "Olli")
    with pytest.raises(NotSignedIn):
        await world.checker.check(copied, "admin.settings.read")


async def test_sign_out_page_redirects_to_sign_in(world: World) -> None:
    await world.sign_in("2002", "Aino")
    r = await world.client.post("/admin/sign-out")
    assert r.status_code == 303 and r.headers["location"] == "/admin/sign-in"
    assert not world.store.sessions


@pytest.mark.parametrize(
    "later",
    [IDLE + timedelta(seconds=1), ABSOLUTE + timedelta(seconds=1)],
    ids=["idle", "absolute"],
)
async def test_expired_session_is_refused(world: World, later: timedelta) -> None:
    await world.sign_in("2002", "Aino")
    if later > ABSOLUTE:
        # Keep it active so only the absolute limit can end it.
        step = START
        while step + IDLE < START + later:
            step += IDLE - timedelta(minutes=1)
            world.clock[0] = step
            assert (await world.client.get("/api/admin/session")).status_code == 200
    world.clock[0] = START + later
    r = await world.client.get("/api/admin/session")
    assert r.status_code == 401 and r.json()["error"]["code"] == "not_signed_in"


async def test_activity_extends_the_idle_expiry(world: World) -> None:
    await world.sign_in("2002", "Aino")
    world.clock[0] = START + IDLE - timedelta(minutes=5)
    body = (await world.client.get("/api/admin/session")).json()
    assert body["expires_at"] == (world.clock[0] + IDLE).isoformat().replace("+00:00", "Z")


async def test_invalid_session_is_refused(world: World) -> None:
    for browser in (world.browser(), world.browser("made-up")):
        r = await browser.get("/api/admin/session")
        assert r.status_code == 401


async def test_pages_send_a_signed_out_browser_to_sign_in(world: World) -> None:
    r = await world.client.get("/admin/settings")
    assert r.status_code == 303 and r.headers["location"] == "/admin/sign-in"


# --- the superadmin flag (#250)


async def test_no_session_is_superadmin_before_the_central_sign_in(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    """contracts/admin.md, Session and rights: true only for a platform-bound session of a
    superadmin with two-factor. Admin's sessions are bound to nothing yet (#52) and no contract
    path tells admin who is a superadmin, so even the owner with two-factor gets false."""
    owner, member = await owner_and_member(world, caplog)
    for token in (owner, member):
        body = (await world.browser(token).get("/api/admin/session")).json()
        assert body["superadmin"] is False


# --- the return path (#227, docs/plans/issue-188.md, Q2)

CHECK_IN = "/notify/check-in?p=arrival&c=AAAAAAAAAAAAAAAAAAAAAA"


async def test_sign_in_returns_to_a_same_site_path(world: World) -> None:
    page = await world.client.get("/admin/sign-in", params={"next": CHECK_IN})
    assert 'name=next value="/notify/check-in?p=arrival&amp;c=AAAA' in page.text
    r = await world.sign_in("2002", "Aino", data={"next": CHECK_IN})
    assert r.status_code == 303 and r.headers["location"] == CHECK_IN
    assert world.client.cookies["canccu_session"]


@pytest.mark.parametrize(
    "unsafe",
    [
        "//evil.example/x",
        "/\\evil.example",
        "https://evil.example/",
        "javascript:alert(1)",
        "notify/check-in",
        "/notify/\tcheck-in",
        "/notify/\ncheck-in",
        "/" + "a" * 2048,
    ],
)
async def test_an_unsafe_return_path_falls_back_to_admin(world: World, unsafe: str) -> None:
    page = await world.client.get("/admin/sign-in", params={"next": unsafe})
    assert "name=next" not in page.text
    r = await world.sign_in("2002", "Aino", data={"next": unsafe})
    assert r.status_code == 303 and r.headers["location"] == "/admin/"


async def test_the_return_path_lives_with_the_flow_not_the_browser(world: World) -> None:
    """The callback takes the path stored with the state, so a crafted callback URL cannot
    redirect anywhere."""
    start = await world.client.post("/admin/sign-in", data={"next": CHECK_IN})
    query = parse_qs(urlsplit(start.headers["location"]).query)
    assert CHECK_IN not in start.headers["location"]
    world.discord.users["c"] = {"id": "1", "username": "x"}
    world.discord.challenges["c"] = query["code_challenge"][0]
    r = await world.client.get(
        CALLBACK, params={"code": "c", "state": query["state"][0], "next": "//evil.example"}
    )
    assert r.headers["location"] == CHECK_IN
