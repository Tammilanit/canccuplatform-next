"""Shell-side writes: the demo tenant and venue (replaces `new-event`, #12) and the first
superadmin (contracts/tenants.md, Superadmin). Both are idempotent and audited as `system`."""

from __future__ import annotations

import secrets
from pathlib import Path
from typing import Any

import yaml
from canccu_kit import DEMO_TENANT

from . import audit, core
from .db import Db

DEMO_VENUE = "demo-venue"
SEED_LOCK = 0x7E7A_5EED  # any constant, distinct from the migration lock
# Loopback serves the local stack; the rest are documentation prefixes (RFC 5737, RFC 3849).
DEMO_ADDRESSES = ["127.0.0.0/8", "::1/128", "192.0.2.0/24", "2001:db8::/32"]


def demo_name(profile: Path) -> str:
    if profile.exists():
        data: Any = yaml.safe_load(profile.read_text()) or {}
        if isinstance(data.get("name"), str):
            return str(data["name"])
    return "Demo Event"


async def seed_demo(db: Db, files: core.Files, profile: Path, platform_domain: str | None) -> bool:
    """Creates the demo venue, the live demo tenant (today and tomorrow) and, with a platform
    domain, its hostname `demo.<domain>`. Returns False when the demo tenant exists already
    (nothing is changed)."""
    outbox = core.Outbox()
    async with db.tenant(DEMO_TENANT) as conn:
        # Several containers may start at once on a fresh database: one seeds, the rest wait
        # and then find the demo tenant.
        await conn.execute("SELECT pg_advisory_xact_lock($1)", SEED_LOCK)
        if await conn.fetchval("SELECT 1 FROM tenants WHERE id = $1", DEMO_TENANT):
            return False
        await conn.execute(
            "INSERT INTO venues (id, name, addresses) VALUES ($1, 'Demo Venue', $2)"
            " ON CONFLICT (id) DO NOTHING",
            DEMO_VENUE,
            DEMO_ADDRESSES,
        )
        # Two days from the day it is made, so the shell shows the event's dates and clock.
        await conn.execute(
            "INSERT INTO tenants (id, name, time_zone, venue_id, status, starts_at, ends_at)"
            " VALUES ($1, $2, 'UTC', $3, 'live', date_trunc('day', now(), 'UTC'),"
            " date_trunc('day', now(), 'UTC') + interval '1 day 18 hours')",
            DEMO_TENANT,
            demo_name(profile),
            DEMO_VENUE,
        )
        await core.copy_venue_in(conn, DEMO_TENANT, DEMO_VENUE, files, audit.SYSTEM, outbox)
        if platform_domain:
            await conn.execute(
                "INSERT INTO hostnames (hostname, tenant_id, kind, status, is_primary)"
                " VALUES ($1, $2, 'platform', 'active', true) ON CONFLICT DO NOTHING",
                f"demo.{platform_domain}",
                DEMO_TENANT,
            )
        await audit.append(
            conn,
            None,
            audit.SYSTEM,
            "tenants.tenant.created",
            {"type": "tenant", "id": DEMO_TENANT},
            {"seed": "demo"},
        )
    outbox.apply_files()
    return True


async def add_superadmin(db: Db, discord_id: str, name: str) -> str:
    """`mfa_enabled` stays false until sign-in reports Discord two-factor (#52), so the
    superadmin paths stay closed until then."""
    async with db.platform() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (id, discord_id, name, superadmin, audit_ref)"
            " VALUES ($1, $2, $3, true, $4) ON CONFLICT (discord_id)"
            " DO UPDATE SET superadmin = true RETURNING id",
            "u_" + secrets.token_hex(8),
            discord_id,
            name,
            "aud_" + secrets.token_hex(12),
        )
        await audit.append(
            conn, None, audit.SYSTEM, "tenants.superadmin.added", {"type": "user", "id": user_id}
        )
    return str(user_id)
