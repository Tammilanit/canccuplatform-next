"""The demo event's own settings for the dev server's demo content (issue #788), in the same
`dev-hostnames` command: the photo wall's flag on and a public Wi-Fi for the screens' venue card.
Dev mode only; never over a value someone set; running it again changes nothing."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import Env

from canccu_tenants import dev_seed, seed

DECLARED = {"screen.photos": False, "screen.pulse": True}


async def demo(env: Env) -> None:
    await seed.seed_demo(
        env.db, env.deps.files, Path("/nonexistent/profile.yaml"), env.deps.platform_domain
    )


async def run(env: Env, version: str = "dev") -> list[str]:
    return await dev_seed.dev_event(env.deps.db, env.deps.bus, version, DECLARED)


async def flag_rows(env: Env) -> dict[str, bool]:
    async with env.db.tenant("demo") as conn:
        rows = await conn.fetch("SELECT name, value FROM tenant_flags")
    return {r["name"]: r["value"] for r in rows}


async def wifi(env: Env) -> list[dict[str, object]]:
    async with env.db.tenant("demo") as conn:
        raw = await conn.fetchval("SELECT wifi FROM venue_info")
    return json.loads(raw) if isinstance(raw, str) else list(raw or [])


async def test_the_photo_wall_is_turned_on_and_the_venue_card_gets_a_public_wifi(
    env: Env,
) -> None:
    await demo(env)
    assert await run(env) == ["screen.photos", "wifi"]
    assert await flag_rows(env) == {"screen.photos": True}
    assert await wifi(env) == [
        {"ssid": "demo-guest", "password": None, "note": None, "visibility": "public"}
    ]
    # Every module drops its cached event, so the wall and the card show at once.
    assert ("t:demo:events:tenants", "tenants.flags.changed") in env.events()
    assert ("t:demo:events:tenants", "tenants.venue_info.changed") in env.events()


async def test_running_it_twice_changes_nothing(env: Env) -> None:
    await demo(env)
    await run(env)
    events = len(env.events())
    assert await run(env) == []
    assert len(env.events()) == events


async def test_a_flag_or_wifi_someone_set_is_left_alone(env: Env) -> None:
    await demo(env)
    async with env.db.tenant("demo") as conn:
        await conn.execute("INSERT INTO tenant_flags (name, value) VALUES ('screen.photos', false)")
        await conn.execute("INSERT INTO venue_info DEFAULT VALUES ON CONFLICT DO NOTHING")
        await conn.execute(
            "UPDATE venue_info SET wifi = $1",
            json.dumps(
                [{"ssid": "crew", "password": "x", "note": None, "visibility": "attendees"}]
            ),
        )
    assert await run(env) == []
    assert await flag_rows(env) == {"screen.photos": False}
    assert [w["ssid"] for w in await wifi(env)] == ["crew"]
    assert env.events() == []


async def test_a_wifi_cleared_by_hand_stays_empty(env: Env) -> None:
    await demo(env)
    await run(env)
    async with env.db.tenant("demo") as conn:
        await conn.execute("UPDATE venue_info SET wifi = '[]', revision = revision + 1")
    events = len(env.events())
    assert await run(env) == []
    assert await wifi(env) == []
    assert len(env.events()) == events


async def test_it_does_nothing_outside_dev_mode(env: Env) -> None:
    await demo(env)
    with pytest.raises(dev_seed.Refused):
        await run(env, version="1.4.0")
    assert await flag_rows(env) == {}
    assert env.events() == []


async def test_without_the_demo_event_it_refuses(env: Env) -> None:
    with pytest.raises(dev_seed.Refused):
        await run(env)
