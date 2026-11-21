"""`python -m canccu_admin dev-seed`: the demo event's profile and assets from events/demo on the
dev server (issue #709). Dev mode only; it loads into an empty event or after the demo profile
changed, and never over what someone made by hand."""

from __future__ import annotations

import os
import shutil
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from canccu_kit import Bus, tenant_scope
from canccu_kit.testing import MemoryStreamStore, require_test_database_url
from conftest import ROOT, World

from canccu_admin import dev_seed
from canccu_admin.db import PgStore
from canccu_admin.declarations import load_declarations
from canccu_admin.profile import make_validator
from canccu_admin.service import Service


@pytest.fixture
def source(tmp_path: Path) -> Path:
    """events/demo as the admin image holds it: the profile and its assets."""
    out = tmp_path / "image-events-demo"
    out.mkdir()
    shutil.copy(ROOT / "events/demo/profile.yaml", out / "profile.yaml")
    shutil.copytree(ROOT / "events/demo/assets", out / "assets")
    return out


async def seed(world: World, source: Path, version: str = "dev", force: bool = False) -> str:
    return await dev_seed.seed_demo_profile(world.service, source, version, force=force)


def events(world: World) -> list[str]:
    return [c.stream for c in world.streams.calls]


async def demo_state(world: World) -> tuple[object, ...]:
    with tenant_scope("demo"):
        return (
            await world.service.store.get_profile(),
            await world.service.store.get_settings("admin"),
            await world.service.store.get_settings("screen"),
            await world.service.store.profile_loaded(),
        )


async def test_an_empty_demo_event_gets_the_demo_profile_and_assets(
    world: World, source: Path
) -> None:
    assert await seed(world, source) == dev_seed.LOADED
    with tenant_scope("demo"):
        profile = await world.service.store.get_profile()
        _, screen = await world.service.store.get_settings("screen")
        logo = await world.service.profile_logo()
    assert profile is not None and profile["name"] == "Demo Event"
    assert screen == {"rotation_seconds": 15}
    assert logo == (source / "assets/logo.svg").read_bytes()
    assert events(world), "theming re-reads the logo on admin.profile.loaded"


async def test_seeding_twice_changes_nothing(world: World, source: Path) -> None:
    await seed(world, source)
    before, published = await demo_state(world), len(events(world))
    assert await seed(world, source) == dev_seed.UP_TO_DATE
    assert await demo_state(world) == before
    assert len(events(world)) == published


async def test_it_does_nothing_outside_dev_mode(world: World, source: Path) -> None:
    with pytest.raises(dev_seed.Refused, match="not dev"):
        await seed(world, source, version="v0.5.1")
    assert await demo_state(world) == (None, (0, {}), (0, {}), None)
    assert events(world) == []


async def test_a_changed_demo_profile_is_loaded_again(world: World, source: Path) -> None:
    await seed(world, source)
    profile = source / "profile.yaml"
    profile.write_text(profile.read_text().replace("rotation_seconds: 15", "rotation_seconds: 20"))
    assert await seed(world, source) == dev_seed.LOADED
    with tenant_scope("demo"):
        _, screen = await world.service.store.get_settings("screen")
    assert screen == {"rotation_seconds": 20}


async def test_a_profile_loaded_by_hand_is_never_replaced(world: World, source: Path) -> None:
    with tenant_scope("demo"):
        shutil.copytree(source, world.service.event_dir)
        await world.service.load_profile("u_po")
    before, published = await demo_state(world), len(events(world))
    assert await seed(world, source) == dev_seed.HAND_MADE
    assert await demo_state(world) == before
    assert len(events(world)) == published


async def test_settings_changed_by_hand_keep_a_new_demo_profile_out(
    world: World, source: Path
) -> None:
    await seed(world, source)
    with tenant_scope("demo"):
        version, values = await world.service.store.get_settings("admin")
        await world.service.put_settings("admin", version, {**values, "language": "fi"}, "u_po")
    profile = source / "profile.yaml"
    profile.write_text(profile.read_text().replace("rotation_seconds: 15", "rotation_seconds: 20"))
    before = await demo_state(world)
    assert await seed(world, source) == dev_seed.HAND_MADE
    assert await demo_state(world) == before


async def test_force_resets_the_demo_profile_over_hand_made_changes(
    world: World, source: Path
) -> None:
    await seed(world, source)
    with tenant_scope("demo"):
        version, values = await world.service.store.get_settings("admin")
        await world.service.put_settings("admin", version, {**values, "language": "fi"}, "u_po")
    assert await seed(world, source, force=True) == dev_seed.LOADED
    with tenant_scope("demo"):
        _, admin = await world.service.store.get_settings("admin")
    assert admin["language"] == "en"


async def test_force_outside_dev_mode_is_refused_too(world: World, source: Path) -> None:
    with pytest.raises(dev_seed.Refused):
        await seed(world, source, version="v0.5.1", force=True)
    assert await demo_state(world) == (None, (0, {}), (0, {}), None)


@pytest.fixture
async def pg_service(tmp_path: Path) -> AsyncIterator[Service]:
    """The seed on Postgres, whose clock stamps the load and the settings changes it compares."""
    url = os.environ.get("CANCCU_DATABASE_URL")
    if not url:
        pytest.skip("CANCCU_DATABASE_URL not set")
    await require_test_database_url(url)
    store = await PgStore.connect(url)
    async with store.pool.acquire() as conn:  # the login role: RLS does not bind it
        await conn.execute(
            "TRUNCATE admin_tenant_settings, admin_tenant_profile, admin_tenant_settings_changes"
        )
    yield Service(
        store,
        Bus(MemoryStreamStore(), "admin"),
        make_validator(ROOT / "contracts/profile.schema.json"),
        tmp_path / "files",
        load_declarations(Path(__file__).parents[1] / "declarations"),
    )
    await store.close()


async def test_on_postgres_it_is_idempotent_and_keeps_hand_made_settings(
    pg_service: Service, source: Path
) -> None:
    run = dev_seed.seed_demo_profile
    assert await run(pg_service, source, "dev", force=False) == dev_seed.LOADED
    assert await run(pg_service, source, "dev", force=False) == dev_seed.UP_TO_DATE
    with tenant_scope("demo"):
        version, values = await pg_service.store.get_settings("admin")
        await pg_service.put_settings("admin", version, {**values, "language": "fi"}, "u_po")
    profile = source / "profile.yaml"
    profile.write_text(profile.read_text().replace("rotation_seconds: 15", "rotation_seconds: 20"))
    assert await run(pg_service, source, "dev", force=False) == dev_seed.HAND_MADE
    with tenant_scope("demo"):
        _, screen = await pg_service.store.get_settings("screen")
    assert screen == {"rotation_seconds": 15}
