"""Roles and rights, checked through the kit, and the page origin check (issue #10)."""

from __future__ import annotations

import json

import pytest
from canccu_kit import MissingRight, NotSignedIn
from conftest import PUBLIC, World, owner_and_member


async def test_rights_are_checked_through_the_kit(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, member = await owner_and_member(world, caplog)
    cookie = f"canccu_session={owner}"
    assert (await world.checker.check(cookie, "admin.rights.write")).user_name == "Olli"
    with pytest.raises(MissingRight):
        await world.checker.check(f"canccu_session={member}", "admin.settings.read")
    with pytest.raises(NotSignedIn):
        await world.checker.check("canccu_session=made-up", "admin.settings.read")
    r = await world.browser(member).get("/api/admin/settings/admin")
    assert r.status_code == 403 and r.json()["error"]["code"] == "missing_right"


async def test_owner_makes_a_member_admin(world: World, caplog: pytest.LogCaptureFixture) -> None:
    _, member = await owner_and_member(world, caplog)
    member_cookie = f"canccu_session={member}"
    with pytest.raises(MissingRight):  # also fills the kit's 30 s cache
        await world.checker.check(member_cookie, "admin.settings.write")
    page = await world.client.get("/admin/people")
    assert "Aino" in page.text and "Olli" in page.text
    aino = next(u for u, _ in await world.store.list_users() if u.name == "Aino")
    r = await world.client.post(f"/admin/people/{aino.id}", data={"role": "admin"})
    assert r.status_code == 303
    # The event drops the cached answer at once instead of after 30 s.
    assert await world.checker.check(member_cookie, "admin.settings.write")
    with pytest.raises(MissingRight):
        await world.checker.check(member_cookie, "admin.rights.write")
    events = [json.loads(c.fields["event"]) for c in world.streams.calls]
    changed = [e for e in events if e["type"] == "admin.rights.changed"]
    assert len(changed) == 1
    owner_id = (await world.client.get("/api/admin/session")).json()["user"]["id"]
    assert changed[0]["data"]["user_id"] == aino.id
    assert changed[0]["data"]["actor_user_id"] == owner_id
    assert "admin.settings.write" in changed[0]["data"]["rights"]
    # An admin cannot hand out rights.
    r = await world.browser(member).post(f"/admin/people/{aino.id}", data={"role": "none"})
    assert r.status_code == 403


async def test_owner_role_cannot_be_changed(world: World, caplog: pytest.LogCaptureFixture) -> None:
    await owner_and_member(world, caplog)
    owner_id = (await world.client.get("/api/admin/session")).json()["user"]["id"]
    r = await world.client.post(f"/admin/people/{owner_id}", data={"role": "none"})
    assert r.status_code == 400
    r = await world.client.post("/admin/people/u_unknown", data={"role": "admin"})
    assert r.status_code == 404


async def test_foreign_origin_is_refused(world: World, caplog: pytest.LogCaptureFixture) -> None:
    await owner_and_member(world, caplog)
    r = await world.client.post("/admin/sign-out", headers={"origin": "https://evil.example"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "bad_origin"
    r = await world.client.post("/admin/sign-out", headers={"origin": PUBLIC})
    assert r.status_code == 303


async def test_origin_refusal_carries_a_correlation_id(world: World) -> None:
    r = await world.client.post("/admin/sign-out", headers={"origin": "https://evil.example"})
    assert r.status_code == 403 and r.headers.get("x-correlation-id")


async def test_signed_in_without_a_role_gets_a_friendly_page(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    _, member = await owner_and_member(world, caplog)
    for path in ("/admin/settings", "/admin/people"):
        r = await world.browser(member).get(path)
        assert r.status_code == 403 and r.headers["content-type"].startswith("text/html")
        assert "ask the owner for a role" in r.text.lower()
        assert "/admin/sign-out" in r.text  # a way out for the wrong account
    r = await world.browser(member).get("/admin/", follow_redirects=True)
    assert r.status_code == 403 and "ask the owner for a role" in r.text.lower()


async def test_people_link_needs_the_rights_right(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, member = await owner_and_member(world, caplog)
    assert 'href="/admin/people"' in (await world.browser(owner).get("/admin/settings")).text
    aino = next(u for u, _ in await world.store.list_users() if u.name == "Aino")
    await world.auth.set_role(aino.id, "admin", "u_owner")
    page = await world.browser(member).get("/admin/settings")
    assert page.status_code == 200
    assert 'href="/admin/people"' not in page.text and 'href="/admin/settings"' in page.text
