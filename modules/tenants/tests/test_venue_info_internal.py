"""The screens' module read of the venue info (contracts/tenants.md, Venue profile, copied into
each event): what a guest sees, whatever the info-page mode."""

from __future__ import annotations

import json

from conftest import Env, make_tenant

HOST = "alpha.example.org"
URL = "/internal/tenants/venue-info"
WIFI = [
    {"ssid": "guest", "password": "welcome", "note": "Lobby", "visibility": "public"},
    {"ssid": "players", "password": "s3cret", "note": None, "visibility": "attendees"},
]


async def _with_venue_info(env: Env, tid: str = "alpha", status: str = "live") -> None:
    await make_tenant(env.db, tid, HOST if tid == "alpha" else f"{tid}.example.org", status=status)
    async with env.db.tenant(tid) as conn:
        await conn.execute(
            "INSERT INTO venue_info (house_rules, wifi) VALUES ($1, $2)",
            "No glass.",
            json.dumps(WIFI),
        )


async def test_screens_read_what_a_guest_sees_in_every_mode(env: Env) -> None:
    await _with_venue_info(env)
    async with env.client(HOST) as c:
        guest = (await c.get("/api/tenants/current/venue-info")).json()
    assert [w["ssid"] for w in guest["wifi"]] == ["guest"]
    for mode in ("public", "venue_only", "sign_in"):
        async with env.db.platform() as conn:
            await conn.execute("UPDATE tenants SET info_page_mode = $1", mode)
        async with env.module("screen") as c:
            r = await c.get(URL, params={"tenant_id": "alpha"})
        assert r.status_code == 200, (mode, r.text)
        assert r.json() == guest, mode
        assert "s3cret" not in r.text
    async with env.client(HOST) as c:
        refused = await c.get("/api/tenants/current/venue-info")
    assert refused.json()["error"]["code"] == "info_pages_closed"  # the guest gate still holds


async def test_screens_read_it_in_every_status_and_empty_before_any_copy(env: Env) -> None:
    for status in ("draft", "live", "archived"):
        await _with_venue_info(env, f"ev-{status}", status)
        async with env.module("screen") as c:
            r = await c.get(URL, params={"tenant_id": f"ev-{status}"})
        assert r.status_code == 200, (status, r.text)
        assert [w["ssid"] for w in r.json()["wifi"]] == ["guest"]
    await make_tenant(env.db, "alpha", HOST)
    async with env.module("screen") as c:
        empty = (await c.get(URL, params={"tenant_id": "alpha"})).json()
    assert empty["wifi"] == [] and empty["house_rules"] == "" and empty["floor_plan"] is None


async def test_venue_info_is_for_the_screen_module_only(env: Env) -> None:
    await _with_venue_info(env)
    async with env.client("tenants:8080") as c:
        unsigned = await c.get(URL, params={"tenant_id": "alpha"})
    async with env.module("notify") as c:
        other = await c.get(URL, params={"tenant_id": "alpha"})
    async with env.module("screen") as c:
        unknown = await c.get(URL, params={"tenant_id": "beta"})
        malformed = await c.get(URL, params={"tenant_id": "Alpha!"})
        missing = await c.get(URL)
    assert unsigned.json()["error"]["code"] == "service_unauthenticated"
    assert (other.status_code, other.json()["error"]["code"]) == (403, "service_forbidden")
    assert (unknown.status_code, unknown.json()["error"]["code"]) == (404, "not_found")
    assert (malformed.status_code, missing.status_code) == (400, 400)
