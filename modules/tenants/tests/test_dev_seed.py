"""`python -m canccu_tenants dev-hostnames`: the dev server's own names for the demo event
(issue #709). Dev mode only; running it again changes nothing."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from canccu_kit.access import VenueIpRefused, check_screen_access
from conftest import Env, make_tenant

from canccu_tenants import dev_seed, seed

# Fully qualified: resolving takes no single-label name (HostnameValue in the OpenAPI file).
SHORT, FULL = "devbox.lan", "devbox.private.example.test"


async def demo(env: Env) -> None:
    await seed.seed_demo(
        env.db, env.deps.files, Path("/nonexistent/profile.yaml"), env.deps.platform_domain
    )


async def run(env: Env, *hosts: str, version: str = "dev") -> list[str]:
    d = env.deps
    return await dev_seed.dev_hostnames(
        d.db,
        d.bus,
        list(hosts),
        version,
        platform_domain=d.platform_domain,
        reserved=d.reserved_hosts,
    )


async def demo_hosts(env: Env) -> list[tuple[str, str, bool]]:
    async with env.db.platform() as conn:
        rows = await conn.fetch(
            "SELECT hostname, status, is_primary FROM hostnames WHERE tenant_id = 'demo'"
            " ORDER BY hostname"
        )
    return [(r["hostname"], r["status"], r["is_primary"]) for r in rows]


async def audit_count(env: Env) -> int:
    async with env.db.pool.acquire() as conn:
        return int(await conn.fetchval("SELECT count(*) FROM platform_audit"))


async def test_the_demo_event_answers_on_the_dev_hostnames_the_first_primary(env: Env) -> None:
    await demo(env)
    changed = await run(env, FULL, SHORT)
    # The old primary hands over, so absolute URLs name the dev server.
    assert sorted(changed) == sorted(["demo.example.test", SHORT, FULL])
    assert await demo_hosts(env) == [
        ("demo.example.test", "active", False),
        (SHORT, "active", False),
        (FULL, "active", True),
    ]
    for host in (SHORT, FULL):
        async with env.client(host) as c:
            r = await c.get("/api/tenants/current")
        assert (r.status_code, r.json().get("id")) == (200, "demo"), (host, r.text)
    # Other modules drop their 30 s resolve cache on it, so the names answer at once.
    assert [t for _, t in env.events()].count("tenants.hostname.changed") == 3


async def test_running_it_twice_changes_nothing(env: Env) -> None:
    await demo(env)
    await run(env, FULL, SHORT)
    hosts, audits, events = await demo_hosts(env), await audit_count(env), len(env.events())
    assert await run(env, FULL, SHORT) == []
    assert await demo_hosts(env) == hosts
    assert await audit_count(env) == audits
    assert len(env.events()) == events


async def test_it_does_nothing_outside_dev_mode(env: Env) -> None:
    await demo(env)
    before = await demo_hosts(env)
    with pytest.raises(dev_seed.Refused, match="not dev"):
        await run(env, FULL, version="v0.5.1")
    assert await demo_hosts(env) == before
    assert env.events() == []


async def test_a_name_another_event_holds_is_refused_and_nothing_changes(env: Env) -> None:
    await demo(env)
    await make_tenant(env.db, "other", SHORT)
    before = await demo_hosts(env)
    with pytest.raises(dev_seed.Refused, match="another event"):
        await run(env, FULL, SHORT)
    assert await demo_hosts(env) == before


@pytest.mark.parametrize(
    "bad",
    ["devbox", "Devbox.lan", "dev box.lan", "devbox.lan.", "-devbox.lan", "super.example.test"],
)
async def test_a_bad_or_reserved_name_is_refused(env: Env, bad: str) -> None:
    await demo(env)
    before = await demo_hosts(env)
    with pytest.raises(dev_seed.Refused):
        await run(env, bad)
    assert await demo_hosts(env) == before


async def test_without_the_demo_event_it_refuses(env: Env) -> None:
    with pytest.raises(dev_seed.Refused, match="no demo event"):
        await run(env, FULL)


async def test_shell_commands_migrate_as_the_migration_role(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """On the stack the login role is plain and may not migrate, so a shell command that
    migrates as it fails before doing anything (found running dev-hostnames in a container)."""
    import argparse

    from canccu_tenants import __main__ as shell
    from canccu_tenants.db import Db

    seen: dict[str, object] = {}

    async def connect(url: str, *, migrate_url: str | None = None) -> None:
        seen.update(url=url, migrate_url=migrate_url)
        raise RuntimeError("stop here")

    monkeypatch.setenv("CANCCU_DATABASE_URL", "postgres://app@db/canccu")
    monkeypatch.setenv("CANCCU_MIGRATE_DATABASE_URL", "postgres://migrator@db/canccu")
    monkeypatch.setattr(Db, "connect", connect)
    with pytest.raises(RuntimeError, match="stop here"):
        await shell.run(argparse.Namespace(command="dev-hostnames", hosts=[FULL]))
    assert seen == {
        "url": "postgres://app@db/canccu",
        "migrate_url": "postgres://migrator@db/canccu",
    }


# The demo venue (issue #733): the dev server is reached over Tailscale, not a venue network.
TAILSCALE = ["100.64.0.0/10", "fd7a:115c:a1e0::/48"]
TAILNET_PC = "100.101.102.103"


async def run_venue(env: Env, version: str = "dev") -> list[str]:
    return await dev_seed.dev_venue(env.deps.db, env.deps.bus, version, TAILSCALE)


async def demo_addresses(env: Env) -> list[str]:
    async with env.db.platform() as conn:
        return list(
            await conn.fetchval("SELECT addresses FROM venues WHERE id = $1", seed.DEMO_VENUE)
        )


async def a_screen_over_tailscale_passes(env: Env) -> bool:
    async with env.module("screen") as c:
        r = await c.get("/internal/tenants/tenants/demo")
    assert r.status_code == 200, r.text
    try:
        check_screen_access(r.json(), device_token_valid=True, client_ip=TAILNET_PC)
    except VenueIpRefused:
        return False
    return True


async def test_screens_over_tailscale_pass_the_venue_check_of_the_demo_event(env: Env) -> None:
    await demo(env)
    assert not await a_screen_over_tailscale_passes(env)
    assert await run_venue(env) == TAILSCALE
    assert await a_screen_over_tailscale_passes(env)
    # Added, never replaced: the local stack's loopback still counts.
    assert await demo_addresses(env) == seed.DEMO_ADDRESSES + TAILSCALE
    # Every module drops its cached TenantContext on it, so screens pass at once.
    assert env.events() == [("events:tenants", "tenants.venue.changed")]
    async with env.db.pool.acquire() as conn:
        entry = await conn.fetchrow(
            "SELECT target, changes FROM platform_audit WHERE action = 'tenants.venue.changed'"
        )
    assert entry is not None
    assert json.loads(entry["target"]) == {"type": "venue", "id": seed.DEMO_VENUE}
    assert json.loads(entry["changes"])["addresses"] == seed.DEMO_ADDRESSES + TAILSCALE


async def test_seeding_the_venue_twice_changes_nothing(env: Env) -> None:
    await demo(env)
    await run_venue(env)
    addresses, audits, events = await demo_addresses(env), await audit_count(env), len(env.events())
    assert await run_venue(env) == []
    assert await demo_addresses(env) == addresses
    assert await audit_count(env) == audits
    assert len(env.events()) == events


async def test_the_venue_is_not_seeded_outside_dev_mode(env: Env) -> None:
    await demo(env)
    with pytest.raises(dev_seed.Refused, match="not dev"):
        await run_venue(env, version="v0.5.1")
    assert await demo_addresses(env) == seed.DEMO_ADDRESSES
    assert env.events() == []


async def test_a_venue_the_superadmin_gave_the_demo_event_is_left_alone(env: Env) -> None:
    """Its addresses decide where a real venue's screens play: never widened by a seed."""
    await demo(env)
    await make_tenant(env.db, "other", SHORT)
    async with env.db.platform() as conn:
        await conn.execute("UPDATE tenants SET venue_id = 'v-other' WHERE id = 'demo'")
    with pytest.raises(dev_seed.LeftAlone, match="not the demo venue"):
        await run_venue(env)
    async with env.db.platform() as conn:
        addresses = await conn.fetchval("SELECT addresses FROM venues WHERE id = 'v-other'")
    assert list(addresses) == ["127.0.0.0/8"]
    assert env.events() == []


async def test_the_demo_venue_shared_with_another_event_is_left_alone(env: Env) -> None:
    await demo(env)
    await make_tenant(env.db, "other", SHORT)
    async with env.db.platform() as conn:
        await conn.execute("UPDATE tenants SET venue_id = $1 WHERE id = 'other'", seed.DEMO_VENUE)
    with pytest.raises(dev_seed.LeftAlone, match="another event"):
        await run_venue(env)
    assert await demo_addresses(env) == seed.DEMO_ADDRESSES


async def test_the_venue_seed_without_the_demo_event_refuses(env: Env) -> None:
    with pytest.raises(dev_seed.Refused, match="no demo event"):
        await run_venue(env)


@pytest.mark.parametrize(
    ("venue", "said"),
    [
        (["100.64.0.0/10"], "the demo venue's addresses: added 100.64.0.0/10"),
        ([], "the demo venue's addresses are in place"),
        (dev_seed.LeftAlone("another event uses the demo venue"), "left alone: another event"),
    ],
)
async def test_the_dev_hostnames_command_seeds_the_venue_too(
    monkeypatch: pytest.MonkeyPatch, venue: list[str] | Exception, said: str
) -> None:
    """The deploy runs one tenants command (setup/deploy, dev_seed); a venue left alone is no
    failure, so the deploy still loads the demo profile after it."""
    from canccu_tenants import __main__ as shell

    seen: dict[str, object] = {}

    async def hostnames(*args: object, **kwargs: object) -> list[str]:
        return []

    async def dev_venue(db: object, bus: object, version: str, tailscale: list[str]) -> list[str]:
        seen.update(version=version, tailscale=tailscale)
        if isinstance(venue, Exception):
            raise venue
        return venue

    for name, value in {
        "CANCCU_MODULE": "tenants",
        "CANCCU_VERSION": "dev",
        "CANCCU_VALKEY_URL": "redis://127.0.0.1:1",
        "CANCCU_ADMIN_URL": "http://admin:8080",
        "CANCCU_DATABASE_URL": "postgres://app@db/canccu",
        "CANCCU_TAILSCALE_CIDRS": "100.64.0.0/10, fd7a:115c:a1e0::/48",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(dev_seed, "dev_hostnames", hostnames)
    monkeypatch.setattr(dev_seed, "dev_venue", dev_venue)
    out = await shell.dev_hostnames(None, [FULL])  # type: ignore[arg-type]
    assert "hostnames are in place" in out
    assert said in out
    assert seen == {"version": "dev", "tailscale": ["100.64.0.0/10", "fd7a:115c:a1e0::/48"]}
