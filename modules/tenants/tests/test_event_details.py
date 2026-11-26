"""What admin's Event page reads and writes here (#782 part B, plan D9): the short name, the
description and the contact person, the venue info's address, and the event's own hostnames and
venue."""

from __future__ import annotations

from conftest import Env, make_tenant

HOST = "alpha.example.org"


async def test_patch_sets_short_name_description_and_contact_and_names_them(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    body = {
        "revision": 1,
        "short_name": "Demo",
        "description": "A weekend of games at the demo venue.",
        "contact_user_id": "u_admin",
    }
    async with env.client(HOST) as c:
        r = await c.patch("/api/tenants/current", json=body, headers=admin)
    got = r.json()
    assert r.status_code == 200, r.text
    assert got["short_name"] == "Demo"
    assert got["description"] == "A weekend of games at the demo venue."
    assert got["contact_user_id"] == "u_admin"
    changed = [
        data["changed"]
        for stream, data in env.event_data()
        if stream == "t:alpha:events:tenants" and data.get("changed")
    ]
    assert ["contact_user_id", "description", "short_name"] in changed


async def test_a_new_event_has_no_short_name_description_or_contact(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    async with env.client(HOST) as c:
        got = (await c.get("/api/tenants/current", headers=env.rights.sign_in("u_admin"))).json()
    assert (got["short_name"], got["description"], got["contact_user_id"]) == ("", "", None)


async def test_too_long_a_short_name_or_description_is_refused(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        short = await c.patch(
            "/api/tenants/current", json={"revision": 1, "short_name": "x" * 25}, headers=admin
        )
        long = await c.patch(
            "/api/tenants/current", json={"revision": 1, "description": "x" * 501}, headers=admin
        )
        contact = await c.patch(
            "/api/tenants/current",
            json={"revision": 1, "contact_user_id": "no spaces"},
            headers=admin,
        )
    assert short.status_code == long.status_code == contact.status_code == 400


async def test_a_guest_sees_short_name_and_description_but_never_the_contact(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    async with env.client(HOST) as c:
        await c.patch(
            "/api/tenants/current",
            json={"revision": 1, "short_name": "Demo", "contact_user_id": "u_admin"},
            headers=env.rights.sign_in("u_admin"),
        )
        guest = (await c.get("/api/tenants/current")).json()
    assert guest["short_name"] == "Demo" and guest["description"] == ""
    assert "contact_user_id" not in guest


async def test_hostnames_list_marks_the_primary_and_needs_the_event_right(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    await make_tenant(env.db, "beta", "beta.example.org")
    async with env.db.platform() as conn:
        await conn.execute(
            "INSERT INTO hostnames (hostname, tenant_id, kind, status, is_primary)"
            " VALUES ('alpha.demo.test', 'alpha', 'platform', 'active', false)"
        )
    async with env.client(HOST) as c:
        guest = await c.get("/api/tenants/current/hostnames")
        crew = await c.get(
            "/api/tenants/current/hostnames", headers=env.rights.sign_in("u_crew", "x.read")
        )
        r = await c.get("/api/tenants/current/hostnames", headers=env.rights.sign_in("u_admin"))
    assert guest.status_code == 401 and crew.status_code == 403
    assert r.json() == {
        "hostnames": [
            {"hostname": HOST, "kind": "custom", "status": "active", "primary": True},
            {
                "hostname": "alpha.demo.test",
                "kind": "platform",
                "status": "active",
                "primary": False,
            },
        ]
    }


async def test_venue_read_answers_the_venue_and_404_without_one(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        r = await c.get("/api/tenants/current/venue", headers=admin)
        async with env.db.platform() as conn:
            await conn.execute("UPDATE tenants SET venue_id = NULL WHERE id = 'alpha'")
        none = await c.get("/api/tenants/current/venue", headers=admin)
        guest = await c.get("/api/tenants/current/venue")
    assert r.json() == {"id": "v-alpha", "name": "v-alpha", "addresses": ["127.0.0.0/8"]}
    assert none.status_code == 404 and none.json()["error"]["code"] == "not_found"
    assert guest.status_code == 401


async def test_another_events_hostnames_and_venue_are_never_answered(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    await make_tenant(env.db, "beta", "beta.example.org", admins=("u_beta",))
    async with env.client("beta.example.org") as c:
        beta = env.rights.sign_in("u_beta")
        hosts = (await c.get("/api/tenants/current/hostnames", headers=beta)).json()
        venue = (await c.get("/api/tenants/current/venue", headers=beta)).json()
    assert [h["hostname"] for h in hosts["hostnames"]] == ["beta.example.org"]
    assert venue["id"] == "v-beta"


async def test_venue_info_keeps_an_address_of_up_to_300_characters(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    info = {"revision": 0, "house_rules": "", "wifi": [], "address": "1 Demo Street, Demo Town"}
    async with env.client(HOST) as c:
        saved = await c.put("/api/tenants/current/venue-info", json=info, headers=admin)
        # A client that does not know the address (an older one) leaves it as it was.
        kept = await c.put(
            "/api/tenants/current/venue-info",
            json={"revision": 1, "house_rules": "Be kind.", "wifi": []},
            headers=admin,
        )
        too_long = await c.put(
            "/api/tenants/current/venue-info",
            json={"revision": 2, "house_rules": "", "wifi": [], "address": "x" * 301},
            headers=admin,
        )
        guest = (await c.get("/api/tenants/current/venue-info")).json()
    assert saved.json()["address"] == "1 Demo Street, Demo Town"
    assert kept.json()["address"] == "1 Demo Street, Demo Town"
    assert too_long.status_code == 400
    assert guest["address"] == "1 Demo Street, Demo Town"
