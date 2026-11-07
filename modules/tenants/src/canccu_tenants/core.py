"""Tenant reads and writes shared by the event admin's `current` paths, the superadmin's registry
and the timers. Every write runs in one tenant transaction with its audit entry; its bus events
are collected in `Outbox` and published only after the commit (plan D7)."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from canccu_kit import Bus, TenantContext, platform_files_dir, tenant_file, tenant_scope

from . import audit, model
from .model import bad_request, conflict, not_found

TENANT_SQL = (
    "SELECT t.*, v.name AS venue_name, v.addresses AS venue_addresses"
    " FROM tenants t LEFT JOIN venues v ON v.id = t.venue_id WHERE t.id = $1"
)
RETENTION = timedelta(days=30)
EVENT_FIELDS = {"name", "time_zone", "starts_at", "ends_at"}
ACCESS_FIELDS = {"info_page_mode", "membership", "admin_access"}


def now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Outbox:
    """What a transaction does only once it has committed: file changes, then bus events. A
    rolled-back write then leaves neither a file nor an event behind."""

    events: list[tuple[str, dict[str, Any], str | None]] = field(default_factory=list)
    file_ops: list[Callable[[], None]] = field(default_factory=list)

    def after_commit(self, op: Callable[[], None]) -> None:
        self.file_ops.append(op)

    def apply_files(self) -> None:
        for op in self.file_ops:
            op()
        self.file_ops.clear()

    def tenant(self, tenant_id: str, type: str, data: dict[str, Any]) -> None:
        self.events.append((type, data, tenant_id))

    def platform(self, type: str, data: dict[str, Any]) -> None:
        self.events.append((type, data, None))

    async def publish(self, bus: Bus) -> None:
        self.apply_files()
        for type, data, tenant_id in self.events:
            if tenant_id is None:
                await bus.publish(type, data, version=1, platform=True)
            else:
                await bus.publish(type, data, version=1, tenant=tenant_id)


@dataclass(frozen=True)
class Files:
    """Floor plans: the venue's under the platform tree, each event's copy under its own."""

    root: str

    def venue_plan(self, venue_id: str) -> Path:
        return Path(platform_files_dir("tenants", self.root), "venues", venue_id, "floor-plan")

    def tenant_plan(self, tenant_id: str) -> Path:
        with tenant_scope(tenant_id):  # the kit builds the path for the current tenant only
            return Path(tenant_file("tenants", "venue-info/floor-plan", self.root))


async def tenant_row(conn: Any, tenant_id: str, *, lock: bool = False) -> Any:
    row = await conn.fetchrow(TENANT_SQL + (" FOR UPDATE OF t" if lock else ""), tenant_id)
    if row is None:
        raise not_found()
    return row


async def primary_hostname(conn: Any, tenant_id: str) -> str | None:
    value: str | None = await conn.fetchval(
        "SELECT hostname FROM hostnames WHERE tenant_id = $1 AND is_primary AND status = 'active'",
        tenant_id,
    )
    return value


async def flags_of(conn: Any, declared: Mapping[str, bool]) -> dict[str, bool]:
    """Every declared flag, stored or default. Needs `conn` in the tenant's transaction."""
    stored = {
        r["name"]: r["value"] for r in await conn.fetch("SELECT name, value FROM tenant_flags")
    }
    return {name: stored.get(name, default) for name, default in declared.items()}


async def full_tenant(conn: Any, tenant_id: str) -> dict[str, Any]:
    row = await tenant_row(conn, tenant_id)
    return model.tenant(row, await primary_hostname(conn, tenant_id), now())


async def tenant_context(conn: Any, tenant_id: str, declared: Mapping[str, bool]) -> TenantContext:
    row = await tenant_row(conn, tenant_id)
    flags = await flags_of(conn, declared)
    return model.context(row, await primary_hostname(conn, tenant_id), flags, now())


def writable(row: Mapping[str, Any]) -> None:
    if row["status"] == "archived":
        raise conflict("event_archived", "this event is archived and read-only")


def write_file(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_bytes(data)
    temp.replace(path)


async def copy_venue_in(
    conn: Any,
    tenant_id: str,
    venue_id: str | None,
    files: Files,
    actor: Mapping[str, Any],
    outbox: Outbox,
) -> list[str]:
    """Copy-in, not a live link: the venue's profile replaces the event's venue info."""
    venue = None
    if venue_id is not None:
        venue = await conn.fetchrow("SELECT * FROM venues WHERE id = $1", venue_id)
        if venue is None:
            raise not_found()
    rules = venue["house_rules"] if venue else ""
    wifi = venue["wifi"] if venue else "[]"
    plan_type = venue["floor_plan_type"] if venue else None
    plan_at = venue["floor_plan_updated_at"] if venue else None
    await conn.execute(
        "INSERT INTO venue_info (venue_id, copied_at, house_rules, wifi, floor_plan_type,"
        " floor_plan_updated_at, revision) VALUES ($1, now(), $2, $3, $4, $5, 1)"
        " ON CONFLICT (tenant_id) DO UPDATE SET venue_id = $1, copied_at = now(), house_rules = $2,"
        " wifi = $3, floor_plan_type = $4, floor_plan_updated_at = $5,"
        " revision = venue_info.revision + 1",
        venue_id,
        rules,
        wifi,
        plan_type,
        plan_at,
    )
    target = files.tenant_plan(tenant_id)
    source = files.venue_plan(venue_id) if venue_id is not None and plan_type else None

    def swap_plan() -> None:
        if source is not None and source.exists():
            write_file(target, source.read_bytes())
        else:
            target.unlink(missing_ok=True)

    outbox.after_commit(swap_plan)
    changed = ["house_rules", "wifi", "floor_plan"]
    await audit.append(
        conn,
        tenant_id,
        actor,
        "tenants.venue_info.changed",
        {"type": "venue_info", "id": tenant_id},
        {"copied_from": venue_id},
    )
    return changed


def _patch_values(body: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if "name" in body:
        out["name"] = model.check_name(body["name"])
    if "time_zone" in body:
        out["time_zone"] = model.check_time_zone(body["time_zone"])
    for key in ("starts_at", "ends_at"):
        if key in body:
            out[key] = model.parse_time(body[key], key)
    if "info_page_mode" in body:
        out["info_page_mode"] = model.check_choice(
            body["info_page_mode"], model.INFO_MODES, "info_page_mode"
        )
    if "membership" in body:
        out["membership"] = model.check_choice(body["membership"], model.MEMBERSHIP, "membership")
    if "admin_access" in body:
        out["admin_access"] = model.check_choice(
            body["admin_access"], model.ADMIN_ACCESS, "admin_access"
        )
    if "venue_id" in body:
        out["venue_id"] = (
            None if body["venue_id"] is None else model.check_id(body["venue_id"], "venue_id")
        )
    if "series_id" in body:
        out["series_id"] = (
            None if body["series_id"] is None else model.check_id(body["series_id"], "series_id")
        )
    return out


async def patch_tenant(
    conn: Any,
    tenant_id: str,
    body: Mapping[str, Any],
    allowed: set[str],
    actor: Mapping[str, Any],
    actor_user_id: str | None,
    files: Files,
    outbox: Outbox,
) -> None:
    unknown = set(body) - allowed - {"revision"}
    if unknown:
        raise bad_request(f"cannot change {', '.join(sorted(unknown))} here")
    revision = model.check_revision(body)
    values = _patch_values(body)
    row = await tenant_row(conn, tenant_id, lock=True)
    writable(row)
    if row["revision"] != revision:
        raise conflict("version_conflict", "the event changed meanwhile; read it again")
    starts = values.get("starts_at", row["starts_at"])
    ends = values.get("ends_at", row["ends_at"])
    if starts and ends and ends < starts:
        raise bad_request("ends_at is before starts_at")
    changed = {k: v for k, v in values.items() if v != row[k]}
    if not changed:
        return
    if changed.get("venue_id") is not None:
        if await conn.fetchval("SELECT 1 FROM venues WHERE id = $1", changed["venue_id"]) is None:
            raise not_found()
    sets = ", ".join(f"{k} = ${i}" for i, k in enumerate(changed, start=2))
    new_revision = await conn.fetchval(
        f"UPDATE tenants SET {sets}, revision = revision + 1 WHERE id = $1 RETURNING revision",
        tenant_id,
        *changed.values(),
    )
    await audit.append(
        conn,
        tenant_id,
        actor,
        "tenants.tenant.changed",
        {"type": "tenant", "id": tenant_id},
        {k: {"old": row[k], "new": v} for k, v in changed.items()},
    )
    outbox.tenant(
        tenant_id,
        "tenants.tenant.changed",
        {
            "changed": sorted(changed),
            "revision": new_revision,
            "actor_user_id": actor_user_id,
        },
    )
    if "venue_id" in changed:
        fields = await copy_venue_in(conn, tenant_id, changed["venue_id"], files, actor, outbox)
        outbox.tenant(
            tenant_id,
            "tenants.venue_info.changed",
            {
                "changed": fields,
                "copied": True,
                "actor_user_id": actor_user_id,
            },
        )


async def change_status(
    conn: Any,
    tenant_id: str,
    body: Mapping[str, Any],
    actor: Mapping[str, Any],
    actor_user_id: str | None,
    outbox: Outbox,
) -> None:
    target = body.get("status")
    if not isinstance(target, str):
        raise bad_request("status must be a string")
    revision = model.check_revision(body)
    row = await tenant_row(conn, tenant_id, lock=True)
    if row["revision"] != revision:
        raise conflict("version_conflict", "the event changed meanwhile; read it again")
    if (row["status"], target) not in model.TRANSITIONS:
        raise conflict("invalid_transition", f"cannot go from {row['status']} to {target}")
    archived_at = now() if target == "archived" else None
    delete_at = archived_at + RETENTION if archived_at else None
    await conn.execute(
        "UPDATE tenants SET status = $2, archived_at = COALESCE($3, archived_at),"
        " presence_delete_at = COALESCE($4, presence_delete_at), revision = revision + 1"
        " WHERE id = $1",
        tenant_id,
        target,
        archived_at,
        delete_at,
    )
    await audit.append(
        conn,
        tenant_id,
        actor,
        "tenants.status.changed",
        {"type": "tenant", "id": tenant_id},
        {"status": {"old": row["status"], "new": target}},
    )
    data: dict[str, Any] = {"from": row["status"], "to": target, "actor_user_id": actor_user_id}
    if delete_at is not None:
        data["presence_delete_at"] = model.iso(delete_at)
    outbox.tenant(tenant_id, "tenants.status.changed", data)
