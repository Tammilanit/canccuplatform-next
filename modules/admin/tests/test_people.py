"""People as v8 sheet 4 (#437): search, a role filter, handles and "Last here", "Show N more",
a role change that applies at once with Undo, Remove with a confirm, the person sheet, and the
empty state with the sign-in link."""

from __future__ import annotations

import html
import json
from datetime import timedelta

import pytest
from canccu_kit import NotSignedIn
from conftest import START, World, first_run_code, owner_and_member

from canccu_admin.auth_db import User


async def _owner(world: World, caplog: pytest.LogCaptureFixture) -> None:
    code = await first_run_code(world, caplog)
    await world.sign_in("1001", "Olli", path="/admin/first-run", data={"code": code})


async def _user(world: World, discord_id: str, name: str, handle: str) -> User:
    return await world.store.upsert_user(discord_id, name, START, handle=handle)


def _rights_events(world: World) -> list[dict[str, object]]:
    events = [json.loads(c.fields["event"]) for c in world.streams.calls]
    return [e["data"] for e in events if e["type"] == "admin.rights.changed"]


async def test_people_shows_handle_last_here_and_who_you_are(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    await _owner(world, caplog)
    await _user(world, "2002", "Alexandria Vanderbilt-Montgomery", "alexandria.vm")
    world.clock[0] = START + timedelta(minutes=30)
    page = html.unescape((await world.client.get("/admin/people")).text)
    assert "alexandria.vm" in page and 'title="Alexandria Vanderbilt-Montgomery"' in page
    assert "· you" in page and "Owner" in page
    assert "Last here" in page and ">12:00<" in page  # Alexandria signed in at START, UTC
    assert "Copy the sign-in link" in page and 'data-canccu-copy="/admin/sign-in"' in page


async def test_search_and_the_role_filter(world: World, caplog: pytest.LogCaptureFixture) -> None:
    await _owner(world, caplog)
    aino = await _user(world, "2002", "Aino", "aino.k")
    await _user(world, "2003", "Player Two", "p2")
    await world.auth.set_role(aino.id, "admin", "u_owner")
    page = (await world.client.get("/admin/people")).text
    assert "Search 3 people" in page
    assert ">All 3<" in page and ">No role yet 1<" in page and ">Admin 1<" in page
    found = (await world.client.get("/admin/people", params={"q": "P2"})).text
    assert "Player Two" in found and "Aino" not in found
    admins = (await world.client.get("/admin/people", params={"role": "admin"})).text
    assert "Aino" in admins and "Player Two" not in admins
    nobody = html.unescape((await world.client.get("/admin/people", params={"q": "zz"})).text)
    assert "No one matches" in nobody


async def test_show_n_more_then_all(world: World, caplog: pytest.LogCaptureFixture) -> None:
    await _owner(world, caplog)
    for n in range(30):
        await _user(world, f"3{n:03}", f"Player {n:02}", f"p{n}")
    page = (await world.client.get("/admin/people")).text
    assert page.count('class="canccu-people__row"') == 25
    assert "6 more people" in page and 'href="/admin/people?show=all"' in page
    every = (await world.client.get("/admin/people", params={"show": "all"})).text
    assert every.count('class="canccu-people__row"') == 31
    assert "All 31 people shown" in every and "Back to top" in every


async def test_a_role_change_applies_at_once_with_undo(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    owner, member = await owner_and_member(world, caplog)
    aino = next(u for u, _ in await world.store.list_users() if u.name == "Aino")
    r = await world.client.post(f"/admin/people/{aino.id}", data={"role": "admin"})
    assert r.status_code == 303
    assert r.headers["location"] == f"/admin/people?changed={aino.id}&from=none"
    page = html.unescape((await world.client.get(r.headers["location"])).text)
    assert "Aino is now an Admin" in page
    assert f'action="/admin/people/{aino.id}"' in page and 'name="undo"' in page
    assert await world.checker.check(f"canccu_session={member}", "admin.settings.write")
    undo = await world.client.post(f"/admin/people/{aino.id}", data={"role": "none", "undo": "1"})
    assert undo.headers["location"] == "/admin/people"
    assert await world.store.get_role(aino.id) == (aino, None)
    assert [e["rights"] for e in _rights_events(world)][-1] == []
    del owner


async def test_a_changed_notice_ignores_a_made_up_role(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    await owner_and_member(world, caplog)
    aino = next(u for u, _ in await world.store.list_users() if u.name == "Aino")
    page = await world.client.get("/admin/people", params={"changed": aino.id, "from": "x<"})
    assert "Undo" not in page.text and "x&lt;" not in page.text


async def test_remove_asks_first_then_signs_them_out(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    _, member = await owner_and_member(world, caplog)
    aino = next(u for u, _ in await world.store.list_users() if u.name == "Aino")
    await world.auth.set_role(aino.id, "admin", "u_owner")
    member_cookie = f"canccu_session={member}"
    await world.checker.check(member_cookie, "admin.settings.read")  # fills the kit's cache
    ask = html.unescape((await world.client.get(f"/admin/people/{aino.id}/remove")).text)
    assert "Remove Aino?" in ask and "They are signed out at once and lose their Admin role" in ask
    assert "Their past changes stay in the history." in ask and "Keep them" in ask
    assert "canccu-button--danger" in ask
    r = await world.client.post(f"/admin/people/{aino.id}/remove")
    assert r.status_code == 303 and r.headers["location"] == f"/admin/people?removed={aino.id}"
    with pytest.raises(NotSignedIn):
        await world.checker.check(member_cookie, "admin.settings.read")
    assert _rights_events(world)[-1] == {
        "user_id": aino.id,
        "rights": [],
        "actor_user_id": (await world.client.get("/api/admin/session")).json()["user"]["id"],
    }
    page = html.unescape((await world.client.get(r.headers["location"])).text)
    assert "Aino was removed" in page and "aino" not in page.split("Aino was removed")[1].lower()


async def test_the_owner_cannot_be_removed(world: World, caplog: pytest.LogCaptureFixture) -> None:
    await owner_and_member(world, caplog)
    owner_id = (await world.client.get("/api/admin/session")).json()["user"]["id"]
    assert (await world.client.post(f"/admin/people/{owner_id}/remove")).status_code == 400
    assert (await world.client.post("/admin/people/u_unknown/remove")).status_code == 404


async def test_only_the_owner_removes(world: World, caplog: pytest.LogCaptureFixture) -> None:
    _, member = await owner_and_member(world, caplog)
    aino = next(u for u, _ in await world.store.list_users() if u.name == "Aino")
    await world.auth.set_role(aino.id, "admin", "u_owner")
    r = await world.browser(member).post(f"/admin/people/{aino.id}/remove")
    assert r.status_code == 403 and await world.store.get_role(aino.id) == (aino, "admin")


async def test_the_person_sheet(world: World, caplog: pytest.LogCaptureFixture) -> None:
    await _owner(world, caplog)
    alex = await _user(world, "2002", "Alexandria Vanderbilt-Montgomery", "alexandria.vm")
    page = html.unescape((await world.client.get(f"/admin/people/{alex.id}")).text)
    assert "Alexandria Vanderbilt-Montgomery" in page and "alexandria.vm · last here" in page
    # Name and "handle · last here" share a column that may shrink, so a long one wraps inside
    # the card on a phone instead of running past it (#476; ui.css .canccu-person).
    assert '<span class="canccu-people__names"><b>Alexandria Vanderbilt-Montgomery</b>' in page
    assert 'aria-pressed="true">No role<' in page and ">Admin<" in page
    assert f'href="/admin/people/{alex.id}/remove"' in page and "Remove from Demo Event" in page
    assert (await world.client.get("/admin/people/u_unknown")).status_code == 404


async def test_with_nobody_else_the_page_offers_the_sign_in_link(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    await _owner(world, caplog)
    page = (await world.client.get("/admin/people")).text
    assert "Only you so far" in page
    assert page.count('data-canccu-copy="/admin/sign-in"') == 2  # the header and the empty state
    assert 'src="/admin/static/people.js"' in page
    assert (await world.client.get("/admin/static/people.js")).status_code == 200
