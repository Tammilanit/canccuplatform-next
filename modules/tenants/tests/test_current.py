"""The request's own event: reads, writes, rights, lifecycle, flags, IP check, venue info, audit."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import asyncpg
import httpx
import pytest
from conftest import SUPERADMIN_HOST, Env, make_tenant, make_user

from canccu_tenants import audit as audit_module
from canccu_tenants import timers

HOST = "alpha.example.org"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32


async def test_guest_sees_public_fields_and_nothing_of_a_draft(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST)
    await make_tenant(env.db, "beta", "beta.example.org", status="draft")
    async with env.client(HOST) as c:
        live = (await c.get("/api/tenants/current")).json()
    async with env.client("beta.example.org") as c:
        draft = (await c.get("/api/tenants/current")).json()
        flags = await c.get("/api/tenants/current/flags")
    assert live["id"] == "alpha" and "revision" not in live and "admin_access" not in live
    assert draft == {"id": "beta", "status": "draft"}
    assert flags.json()["error"]["code"] == "info_pages_closed"


async def test_patch_needs_a_right_and_the_role_for_access_settings(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    granted = env.rights.sign_in("u_granted", "tenants.event.write", "tenants.access.write")
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        guest = await c.patch("/api/tenants/current", json={"revision": 1, "name": "X"})
        named = await c.patch(
            "/api/tenants/current", json={"revision": 1, "name": "New"}, headers=granted
        )
        stale = await c.patch(
            "/api/tenants/current", json={"revision": 1, "name": "Y"}, headers=granted
        )
        access = await c.patch(
            "/api/tenants/current",
            json={"revision": 2, "admin_access": "internet"},
            headers=granted,
        )
        by_role = await c.patch(
            "/api/tenants/current", json={"revision": 2, "admin_access": "internet"}, headers=admin
        )
    assert guest.status_code == 401
    assert named.json()["name"] == "New" and named.json()["revision"] == 2
    assert stale.json()["error"]["code"] == "version_conflict"
    assert access.json()["error"]["code"] == "missing_right"  # role-only, a right is not enough
    assert by_role.json()["admin_access"] == "internet"
    assert ("t:alpha:events:tenants", "tenants.tenant.changed") in env.events()


async def test_restricted_admin_access_refuses_other_addresses(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    async with env.db.platform() as conn:
        await conn.execute("UPDATE venues SET addresses = '{192.0.2.0/24}'")
    async with env.client(HOST) as c:
        r = await c.patch(
            "/api/tenants/current",
            json={"revision": 1, "name": "X"},
            headers=env.rights.sign_in("u_admin"),
        )
    assert r.json()["error"]["code"] == "admin_access_restricted"


async def test_lifecycle_and_archived_is_read_only(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        back = await c.post(
            "/api/tenants/current/status", json={"status": "draft", "revision": 1}, headers=admin
        )
        archived = await c.post(
            "/api/tenants/current/status", json={"status": "archived", "revision": 1}, headers=admin
        )
        write = await c.put(
            "/api/tenants/current/flags",
            json={"flags_version": 0, "flags": {"bot.stats": True}},
            headers=admin,
        )
    assert back.json()["error"]["code"] == "invalid_transition"
    assert archived.json()["status"] == "archived"
    delete_at = datetime.fromisoformat(archived.json()["presence_delete_at"])
    archived_at = datetime.fromisoformat(archived.json()["archived_at"])
    assert delete_at - archived_at == timedelta(days=30)
    assert write.json()["error"]["code"] == "event_archived"


async def test_flags(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        unknown = await c.put(
            "/api/tenants/current/flags",
            json={"flags_version": 0, "flags": {"bot.nope": True}},
            headers=admin,
        )
        ok = await c.put(
            "/api/tenants/current/flags",
            json={"flags_version": 0, "flags": {"bot.stats": True}},
            headers=admin,
        )
        stale = await c.put(
            "/api/tenants/current/flags",
            json={"flags_version": 0, "flags": {"bot.stats": False}},
            headers=admin,
        )
        read = (await c.get("/api/tenants/current/flags")).json()
    assert unknown.json()["error"]["code"] == "unknown_flag"
    assert ok.json() == {"flags_version": 1, "flags": {"bot.stats": True, "screen.pulse": True}}
    assert stale.json()["error"]["code"] == "version_conflict"
    assert read == ok.json()


async def test_venue_ip_check_switch_and_its_automatic_return(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    soon = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    too_far = (datetime.now(UTC) + timedelta(hours=49)).isoformat()
    async with env.client(HOST) as c:
        far = await c.put(
            "/api/tenants/current/venue-ip-check",
            json={"enabled": False, "reason": "new NAT", "until": too_far},
            headers=admin,
        )
        no_reason = await c.put(
            "/api/tenants/current/venue-ip-check",
            json={"enabled": False, "until": soon},
            headers=admin,
        )
        off = await c.put(
            "/api/tenants/current/venue-ip-check",
            json={"enabled": False, "reason": "new NAT", "until": soon},
            headers=admin,
        )
    assert far.status_code == 400 and no_reason.status_code == 400
    assert off.json()["enabled"] is False and off.json()["reason"] == "new NAT"
    async with env.db.platform() as conn:
        await conn.execute("UPDATE tenants SET ip_check_disabled_until = now() - interval '1s'")
    await timers.run_due(env.deps)
    await timers.run_due(env.deps)  # a second round finds nothing to do
    async with env.client(HOST) as c:
        audit = (await c.get("/api/tenants/current/audit", headers=admin)).json()["entries"]
    switches = [e for e in audit if e["action"] == "tenants.venue_ip_check.changed"]
    assert [e["actor"]["kind"] for e in switches] == ["system", "user"]
    assert env.events().count(("t:alpha:events:tenants", "tenants.venue_ip_check.changed")) == 2


async def test_venue_info_is_copied_in_and_hides_attendee_wifi_from_guests(env: Env) -> None:
    async with env.db.platform() as conn:
        await make_user(conn, "u_super", superadmin=True)
    sa = env.rights.sign_in("u_super")
    wifi = [
        {"ssid": "guest", "password": None, "note": None, "visibility": "public"},
        {"ssid": "crew", "password": "secret-pass", "note": None, "visibility": "attendees"},
    ]
    async with env.client(SUPERADMIN_HOST) as c:
        venue = (
            await c.post(
                "/api/tenants/venues",
                headers=sa,
                json={
                    "name": "Hall",
                    "addresses": ["127.0.0.1"],
                    "profile": {"house_rules": "No glass.", "wifi": wifi},
                },
            )
        ).json()
        await c.put(f"/api/tenants/venues/{venue['id']}/floor-plan", content=PNG, headers=sa)
        svg = await c.put(
            f"/api/tenants/venues/{venue['id']}/floor-plan", content=b"<svg/>", headers=sa
        )
        await c.post(
            "/api/tenants/registry",
            headers=sa,
            json={
                "id": "alpha",
                "name": "Alpha",
                "time_zone": "UTC",
                "venue_id": venue["id"],
            },
        )
        await c.post("/api/tenants/registry/alpha/hostnames", json={"hostname": HOST}, headers=sa)
        env.txt[f"_canccu-verify.{HOST}"] = [
            (await c.get("/api/tenants/registry/alpha/hostnames", headers=sa)).json()["hostnames"][
                0
            ]["verification"]["txt_value"]
        ]
        await c.post(f"/api/tenants/hostnames/{HOST}/verify", headers=sa)
        await c.post(
            "/api/tenants/registry/alpha/status", json={"status": "live", "revision": 1}, headers=sa
        )
        changed = await c.patch(
            f"/api/tenants/venues/{venue['id']}",
            headers=sa,
            json={
                "revision": venue["revision"] + 1,
                "profile": {"house_rules": "Changed later.", "wifi": []},
            },
        )
        in_use = await c.delete(f"/api/tenants/venues/{venue['id']}", headers=sa)
    assert svg.json()["error"]["code"] == "unsupported_type"
    assert changed.status_code == 200
    assert in_use.json()["error"]["code"] == "venue_in_use"
    async with env.client(HOST) as c:
        info = (await c.get("/api/tenants/current/venue-info")).json()
        plan = await c.get("/api/tenants/current/venue-info/floor-plan")
    assert info["house_rules"] == "No glass."  # a copy: later venue edits do not reach it
    assert [w["ssid"] for w in info["wifi"]] == ["guest"]
    assert plan.content == PNG and plan.headers["content-type"] == "image/png"
    assert plan.headers["x-content-type-options"] == "nosniff"


async def test_info_page_mode_sign_in_closes_venue_info_to_guests(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST)
    async with env.db.platform() as conn:
        await conn.execute("UPDATE tenants SET info_page_mode = 'sign_in'")
    async with env.client(HOST) as c:
        r = await c.get("/api/tenants/current/venue-info")
    assert r.json()["error"]["code"] == "info_pages_closed"


async def test_audit_is_append_only_for_the_app_role(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST)
    async with env.client("tenants:8080") as c:
        appended = await c.post(
            "/internal/tenants/audit",
            json={
                "tenant_id": "alpha",
                "module": "screen",
                "action": "screen.device.moved",
                "target": {"type": "device", "id": "d1"},
                "actor_user_id": "u_x",
            },
        )
        wrong = await c.post(
            "/internal/tenants/audit",
            json={
                "tenant_id": "alpha",
                "module": "bot",
                "action": "screen.device.moved",
                "target": {"type": "device", "id": "d1"},
            },
        )
    assert appended.status_code == 201
    assert appended.json()["actor"] == {
        "kind": "user",
        "ref": None,
        "superadmin": False,
        "support": False,
    }
    assert wrong.status_code == 400
    for statement in (
        "UPDATE audit SET action = 'x.y.z'",
        "DELETE FROM audit",
        "DELETE FROM platform_audit",
    ):
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            async with env.db.tenant("alpha") as conn:
                await conn.execute(statement)


async def test_concurrent_first_venue_info_writes_never_overwrite(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        results = await asyncio.gather(
            *(
                c.put(
                    "/api/tenants/current/venue-info",
                    headers=admin,
                    json={"revision": 0, "house_rules": f"rules {i}", "wifi": []},
                )
                for i in range(4)
            )
        )
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409]


async def test_an_unchanged_venue_info_write_is_not_audited(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    body = {"house_rules": "Same.", "wifi": []}
    async with env.client(HOST) as c:
        first = await c.put(
            "/api/tenants/current/venue-info", headers=admin, json=body | {"revision": 0}
        )
        again = await c.put(
            "/api/tenants/current/venue-info",
            headers=admin,
            json=body | {"revision": first.json()["revision"]},
        )
        audit = (await c.get("/api/tenants/current/audit", headers=admin)).json()["entries"]
    assert again.json()["revision"] == first.json()["revision"]
    assert [e["action"] for e in audit].count("tenants.venue_info.changed") == 1
    assert env.events().count(("t:alpha:events:tenants", "tenants.venue_info.changed")) == 1


async def test_a_failed_floor_plan_write_leaves_no_file(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")

    async def broken(*args: object, **kwargs: object) -> None:
        raise RuntimeError("audit down")

    monkeypatch.setattr(audit_module, "append", broken)
    transport = httpx.ASGITransport(
        app=env.app, client=("127.0.0.1", 5000), raise_app_exceptions=False
    )
    async with httpx.AsyncClient(transport=transport, base_url=f"http://{HOST}") as c:
        r = await c.put("/api/tenants/current/venue-info/floor-plan", content=PNG, headers=admin)
    assert r.status_code == 500
    assert not env.deps.files.tenant_plan("alpha").exists()


async def test_malformed_input_is_400_not_500(env: Env) -> None:
    await make_tenant(env.db, "alpha", HOST, admins=("u_admin",))
    admin = env.rights.sign_in("u_admin")
    async with env.client(HOST) as c:
        status = await c.post(
            "/api/tenants/current/status", json={"status": ["live"], "revision": 1}, headers=admin
        )
        limit = await c.get("/api/tenants/current/audit", params={"limit": "²"}, headers=admin)
    assert (status.status_code, limit.status_code) == (400, 400)


async def test_two_seeds_at_once_create_one_demo(env: Env) -> None:
    from pathlib import Path

    from canccu_tenants import seed

    none = Path("/nonexistent/profile.yaml")
    created = await asyncio.gather(
        *(seed.seed_demo(env.db, env.deps.files, none, None) for _ in range(3))
    )
    assert sorted(created) == [False, False, True]
