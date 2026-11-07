"""Shell-side writes: the demo tenant and venue (replaces `new-event`, #12) and the first
superadmin (contracts/tenants.md, Superadmin). Both are idempotent and audited as `system`."""

from __future__ import annotations

import secrets
from pathlib import Path
from typing import Any

import yaml

from . import audit, core
from .db import Db

DEMO_TENANT = "demo"
DEMO_VENUE = "demo-venue"
# Loopback serves the local stack; the rest are documentation prefixes (RFC 5737, RFC 3849).
DEMO_ADDRESSES = ["127.0.0.0/8", "::1/128", "192.0.2.0/24", "2001:db8::/32"]


def demo_name(profile: Path) -> str:
    if profile.exists():
        data: Any = yaml.safe_load(profile.read_text()) or {}
        if isinstance(data.get("name"), str):
            return str(data["name"])
    return "Demo Event"


async def seed_demo(db: Db, files: core.Files, profile: Path, platform_domain: str | None) -> bool:
    """Creates the demo venue, the live demo tenant and, with a platform domain, its hostname
    `demo.<domain>`. Returns False when the demo tenant exists already (nothing is changed)."""
    async with db.tenant(DEMO_TENANT) as conn:
        if await conn.fetchval("SELECT 1 FROM tenants WHERE id = $1", DEMO_TENANT):
            return False
        await conn.execute(
            "INSERT INTO venues (id, name, addresses) VALUES ($1, 'Demo Venue', $2)"
            " ON CONFLICT (id) DO NOTHING",
            DEMO_VENUE,
            DEMO_ADDRESSES,
        )
        await conn.execute(
            "INSERT INTO tenants (id, name, time_zone, venue_id, status)"
            " VALUES ($1, $2, 'UTC', $3, 'live')",
            DEMO_TENANT,
            demo_name(profile),
            DEMO_VENUE,
        )
        await core.copy_venue_in(conn, DEMO_TENANT, DEMO_VENUE, files, audit.SYSTEM)
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
