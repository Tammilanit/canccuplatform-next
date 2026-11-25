"""The dev server's own hostnames for the demo event (issue #709): `setup/deploy` runs
`python -m canccu_tenants dev-hostnames` after each deploy in dev mode, with the names of
`CANCCU_DEV_HOSTNAMES` in deploy/.env. Pages resolve the event from `Host`, so without them the
dev server answers every page with 404.

The same command gives the demo venue the platform's Tailscale prefixes (issue #733): the dev
server is reached over Tailscale, not a venue network, and a screen plays only from its event's
venue addresses (contracts/tenants.md, Venue IP check).

And it gives the demo event what its demo content needs (issue #788): the photo wall's flag on,
so the screens show the seeded photos, and a public Wi-Fi, so the main zone's venue rail turns
between the venue card and the food box.

All only add and never remove: a name dropped from the env file stays until the demo event is
reset (docs/operations/dev-server.md), so it never undoes a change made by hand."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from canccu_kit import DEMO_TENANT, Bus, KitError
from canccu_kit.resolve import normalize_host

from . import audit, core, model
from .db import Db
from .hostnames import kind_of
from .seed import DEMO_VENUE


class Refused(Exception):
    """Nothing was changed; the message says why."""


class LeftAlone(Exception):
    """Nothing was changed on purpose; the message says why. Not a failure: the deploy goes on."""


def _dev_mode(version: str) -> None:
    if version != "dev":
        raise Refused(f"CANCCU_VERSION is {version}, not dev: nothing changed")


def _check(hosts: list[str], version: str, reserved: frozenset[str]) -> None:
    _dev_mode(version)
    if not hosts:
        raise Refused("no hostnames given: nothing changed")
    for host in hosts:
        if normalize_host(host) != host or not model.HOSTNAME_RE.fullmatch(host):
            # Resolving takes no single-label name (contracts/tenants.openapi.yaml, HostnameValue).
            raise Refused(f"{host!r} is not a fully qualified lowercase hostname: nothing changed")
        if host in reserved:
            raise Refused(f"{host} is one of the platform's own hostnames: nothing changed")


async def dev_hostnames(
    db: Db,
    bus: Bus,
    hosts: list[str],
    version: str,
    *,
    platform_domain: str | None,
    reserved: frozenset[str],
) -> list[str]:
    """Makes every name an active hostname of the demo event, the first one primary. Returns
    the names whose row changed; an empty list when all was in place already."""
    _check(hosts, version, reserved)
    outbox = core.Outbox()
    changed: list[str] = []
    async with db.platform() as conn:
        # The same lock order as the superadmin's hostname writes (hostnames.py).
        if not await conn.fetchval("SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE", DEMO_TENANT):
            raise Refused("no demo event (the tenants module seeds it at start): nothing changed")
        for i, host in enumerate(hosts):
            row = await conn.fetchrow(
                "SELECT * FROM hostnames WHERE hostname = $1 FOR UPDATE", host
            )
            if row is not None and row["tenant_id"] != DEMO_TENANT:
                # Refused raises inside the transaction, so the names before it roll back too.
                raise Refused(f"{host} belongs to another event: nothing changed")
            primary = i == 0
            if row is not None and row["status"] == "active" and row["is_primary"] == primary:
                continue
            if primary:
                for old in await conn.fetch(
                    "UPDATE hostnames SET is_primary = false WHERE tenant_id = $1 AND is_primary"
                    " AND hostname <> $2 RETURNING *",
                    DEMO_TENANT,
                    host,
                ):
                    await _changed(
                        conn, outbox, "tenants.hostname.changed", old, {"primary": False}
                    )
                    changed.append(old["hostname"])
            if row is None:
                new = await conn.fetchrow(
                    "INSERT INTO hostnames (hostname, tenant_id, kind, status, is_primary)"
                    " VALUES ($1, $2, $3, 'active', $4) RETURNING *",
                    host,
                    DEMO_TENANT,
                    kind_of(platform_domain, host),
                    primary,
                )
                await _changed(conn, outbox, "tenants.hostname.added", new, {"kind": new["kind"]})
            else:
                # A name of the demo event that is held, pending or not primary yet.
                new = await conn.fetchrow(
                    "UPDATE hostnames SET status = 'active', is_primary = $2, verify_token = NULL,"
                    " held_until = NULL WHERE hostname = $1 RETURNING *",
                    host,
                    primary,
                )
                await _changed(
                    conn,
                    outbox,
                    "tenants.hostname.changed",
                    new,
                    {"status": "active", "primary": primary},
                )
            changed.append(host)
    await outbox.publish(bus)
    return changed


async def dev_venue(db: Db, bus: Bus, version: str, tailscale: list[str]) -> list[str]:
    """Adds the Tailscale prefixes to the demo venue's addresses. Returns those it added; an
    empty list when all were there already."""
    _dev_mode(version)
    async with db.platform() as conn:
        # The superadmin's venue writes lock the venue row too (venues.py).
        venue_id = await conn.fetchval(
            "SELECT venue_id FROM tenants WHERE id = $1 FOR UPDATE", DEMO_TENANT
        )
        if venue_id is None and not await conn.fetchval(
            "SELECT 1 FROM tenants WHERE id = $1", DEMO_TENANT
        ):
            raise Refused("no demo event (the tenants module seeds it at start): nothing changed")
        # A seed never widens where a real venue's screens play: only the seed's own venue,
        # and only while no other event uses it.
        if venue_id != DEMO_VENUE:
            raise LeftAlone(f"the demo event's venue is not the demo venue ({DEMO_VENUE})")
        row = await conn.fetchrow("SELECT * FROM venues WHERE id = $1 FOR UPDATE", DEMO_VENUE)
        if await conn.fetchval(
            "SELECT 1 FROM tenants WHERE venue_id = $1 AND id <> $2", DEMO_VENUE, DEMO_TENANT
        ):
            raise LeftAlone(f"another event uses the demo venue ({DEMO_VENUE})")
        have = list(row["addresses"])
        try:
            added = [a for a in model.check_addresses(tailscale) if a not in have]
            addresses = model.check_addresses(have + added)
        except KitError as exc:
            raise Refused(f"CANCCU_TAILSCALE_CIDRS: {exc}: nothing changed") from exc
        if not added:
            return []
        await conn.execute(
            "UPDATE venues SET addresses = $2, revision = revision + 1 WHERE id = $1",
            DEMO_VENUE,
            addresses,
        )
        # Addresses are audited with values, as the superadmin's venue writes are (venues.py).
        await audit.append(
            conn,
            None,
            audit.SYSTEM,
            "tenants.venue.changed",
            {"type": "venue", "id": DEMO_VENUE},
            {"fields": ["addresses"], "addresses": addresses, "seed": "dev"},
        )
    # A platform event: every module drops its cached TenantContext, so screens pass at once.
    await bus.publish(
        "tenants.venue.changed",
        {"venue_id": DEMO_VENUE, "changed": ["addresses"], "deleted": False},
        version=1,
        platform=True,
    )
    return added


# The CI stack's demo Wi-Fi too (deploy/compose.ci.yml): a guest network, no password.
DEMO_WIFI = [{"ssid": "demo-guest", "password": None, "note": None, "visibility": "public"}]
PHOTOS = "screen.photos"


async def dev_event(db: Db, bus: Bus, version: str, declared: Mapping[str, bool]) -> list[str]:
    """Turns the demo event's photo wall on while nobody set its flag, and gives the demo event
    a public Wi-Fi while it has none. Returns what it changed (`screen.photos`, `wifi`)."""
    _dev_mode(version)
    changed: list[str] = []
    async with db.tenant(DEMO_TENANT) as conn:
        row = await conn.fetchrow("SELECT * FROM tenants WHERE id = $1 FOR UPDATE", DEMO_TENANT)
        if row is None:
            raise Refused("no demo event (the tenants module seeds it at start): nothing changed")
        # A stored value, on or off, is someone's choice; only the default gives way.
        if await conn.fetchval("SELECT 1 FROM tenant_flags WHERE name = $1", PHOTOS) is None:
            await conn.execute("INSERT INTO tenant_flags (name, value) VALUES ($1, true)", PHOTOS)
            flags_version = await conn.fetchval(
                "UPDATE tenants SET flags_version = flags_version + 1 WHERE id = $1"
                " RETURNING flags_version",
                DEMO_TENANT,
            )
            await audit.append(
                conn,
                DEMO_TENANT,
                audit.SYSTEM,
                "tenants.flags.changed",
                {"type": "tenant", "id": DEMO_TENANT},
                {PHOTOS: {"old": False, "new": True}, "seed": "dev"},
            )
            flags = await core.flags_of(conn, declared)
            changed.append(PHOTOS)
        await conn.execute("INSERT INTO venue_info DEFAULT VALUES ON CONFLICT DO NOTHING")
        info = await conn.fetchrow("SELECT * FROM venue_info FOR UPDATE")
        if not model.wifi_of(info):
            await conn.execute(
                "UPDATE venue_info SET wifi = $1, revision = revision + 1", json.dumps(DEMO_WIFI)
            )
            # Field names only, as the organiser's writes (venue_info.py).
            await audit.append(
                conn,
                DEMO_TENANT,
                audit.SYSTEM,
                "tenants.venue_info.changed",
                {"type": "venue_info", "id": DEMO_TENANT},
                {"fields": ["wifi"], "seed": "dev"},
            )
            changed.append("wifi")
    if PHOTOS in changed:
        await bus.publish(
            "tenants.flags.changed",
            {
                "flags_version": flags_version,
                "changed": [PHOTOS],
                "flags": flags,
                "actor_user_id": None,
            },
            version=1,
            tenant=DEMO_TENANT,
        )
    if "wifi" in changed:
        await bus.publish(
            "tenants.venue_info.changed",
            {"changed": ["wifi"], "copied": False, "actor_user_id": None},
            version=1,
            tenant=DEMO_TENANT,
        )
    return changed


async def _changed(
    conn: Any, outbox: core.Outbox, action: str, row: Any, changes: dict[str, Any]
) -> None:
    await audit.append(
        conn,
        None,
        audit.SYSTEM,
        action,
        {"type": "hostname", "id": row["hostname"]},
        {"tenant_id": row["tenant_id"], "seed": "dev", **changes},
    )
    core.hostname_changed(outbox, row)
