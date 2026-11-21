"""The dev server's own hostnames for the demo event (issue #709): `setup/deploy` runs
`python -m canccu_tenants dev-hostnames` after each deploy in dev mode, with the names of
`CANCCU_DEV_HOSTNAMES` in deploy/.env. Pages resolve the event from `Host`, so without them the
dev server answers every page with 404.

It only adds and never removes: a name dropped from the env file stays until the demo event is
reset (docs/operations/dev-server.md), so it never undoes a change made by hand."""

from __future__ import annotations

from typing import Any

from canccu_kit import DEMO_TENANT, Bus
from canccu_kit.resolve import normalize_host

from . import audit, core, model
from .db import Db
from .hostnames import kind_of


class Refused(Exception):
    """Nothing was changed; the message says why."""


def _check(hosts: list[str], version: str, reserved: frozenset[str]) -> None:
    if version != "dev":
        raise Refused(f"CANCCU_VERSION is {version}, not dev: nothing changed")
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
