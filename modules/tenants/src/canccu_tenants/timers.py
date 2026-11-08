"""Due times: the venue IP check's switch back and the end of a hostname's hold.

Every container runs this loop. Each step is one conditional UPDATE or DELETE, so when two
containers race only one gets the row back, and only it audits and emits (plan D8).
"""

from __future__ import annotations

import asyncio
import logging

from . import audit, core
from .deps import Deps

INTERVAL_SECONDS = 30
log = logging.getLogger("canccu.tenants.timers")


async def run_due(d: Deps) -> None:
    async with d.db.platform() as conn:
        due = [
            r["id"]
            for r in await conn.fetch(
                "SELECT id FROM tenants WHERE ip_check_disabled_until <= now()"
            )
        ]
    for tid in due:
        async with d.db.tenant(tid) as conn:
            switched = await conn.fetchval(
                "UPDATE tenants SET ip_check_disabled_until = NULL, ip_check_reason = NULL,"
                " revision = revision + 1 WHERE id = $1 AND ip_check_disabled_until <= now()"
                " RETURNING id",
                tid,
            )
            if switched:
                await audit.append(
                    conn,
                    tid,
                    audit.SYSTEM,
                    "tenants.venue_ip_check.changed",
                    {"type": "tenant", "id": tid},
                    {"enabled": {"old": False, "new": True}},
                )
        if switched:
            await d.bus.publish(
                "tenants.venue_ip_check.changed",
                {"enabled": True, "until": None, "actor_user_id": None},
                version=1,
                tenant=tid,
            )
    outbox = core.Outbox()
    async with d.db.platform() as conn:
        released = await conn.fetch(
            "DELETE FROM hostnames WHERE status = 'held' AND held_until <= now()"
            " RETURNING hostname, tenant_id"
        )
        for row in released:
            await audit.append(
                conn,
                None,
                audit.SYSTEM,
                "tenants.hostname.released",
                {"type": "hostname", "id": row["hostname"]},
                {"tenant_id": row["tenant_id"]},
            )
            core.hostname_changed(outbox, row, status="released", primary=False)
    await outbox.publish(d.bus)


async def loop(d: Deps) -> None:
    while True:
        try:
            await run_due(d)
        except Exception:  # a failed round is retried on the next one; never stop the loop
            log.exception("timer round failed")
        await asyncio.sleep(INTERVAL_SECONDS)
