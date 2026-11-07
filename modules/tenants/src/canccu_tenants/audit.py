"""The audit log (contracts/tenants.md, Audit log): appended in the transaction of the change.

Append-only: the app role may only INSERT and SELECT here (migrations/001_tenants.sql). Entries hold
the user's audit reference, never a name or a Discord id.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any

from canccu_kit import get_correlation_id, new_id

from .model import bad_request, iso

ACTION_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$")
SYSTEM: dict[str, Any] = {"kind": "system", "ref": None, "superadmin": False, "support": False}


def module_actor(module: str) -> dict[str, Any]:
    return {"kind": "module", "ref": module, "superadmin": False, "support": False}


async def user_actor(conn: Any, user_id: str | None) -> dict[str, Any]:
    """`superadmin` comes from the user row, never from the caller. `support` stays false until
    support windows exist (#150). A session user not yet in the registry (before the central
    sign-in, #52) has no audit reference."""
    if user_id is None:
        return SYSTEM
    row = await conn.fetchrow("SELECT audit_ref, superadmin FROM users WHERE id = $1", user_id)
    return {
        "kind": "user",
        "ref": None if row is None else row["audit_ref"],
        "superadmin": bool(row and row["superadmin"]),
        "support": False,
    }


async def append(
    conn: Any,
    tenant_id: str | None,
    actor: Mapping[str, Any],
    action: str,
    target: Mapping[str, str],
    changes: Mapping[str, Any] | None = None,
    reason: str | None = None,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """`tenant_id` None writes a platform entry. A tenant entry needs `conn` in that tenant's
    transaction: RLS refuses it otherwise."""
    entry_id = new_id()
    table = "platform_audit" if tenant_id is None else "audit"
    row = await conn.fetchrow(
        f"INSERT INTO {table} (id, actor, action, target, changes, reason, correlation_id)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING time",
        entry_id,
        json.dumps(actor),
        action,
        json.dumps(dict(target)),
        json.dumps(dict(changes or {}), default=str),
        reason,
        correlation_id or get_correlation_id(),
    )
    return {
        "id": entry_id,
        "time": iso(row["time"]),
        "tenant_id": tenant_id,
        "actor": dict(actor),
        "action": action,
        "target": dict(target),
        "changes": dict(changes or {}),
        "reason": reason,
        "correlation_id": correlation_id or get_correlation_id(),
    }


def _entry(row: Mapping[str, Any], tenant_id: str | None) -> dict[str, Any]:
    def load(value: Any) -> Any:
        return json.loads(value) if isinstance(value, str) else value

    return {
        "id": row["id"],
        "time": iso(row["time"]),
        "tenant_id": tenant_id,
        "actor": load(row["actor"]),
        "action": row["action"],
        "target": load(row["target"]),
        "changes": load(row["changes"]),
        "reason": row["reason"],
        "correlation_id": row["correlation_id"],
    }


def page_args(query: Mapping[str, str]) -> tuple[str | None, int]:
    before = query.get("before")
    raw = query.get("limit", "50")
    if not raw.isdigit() or not 1 <= int(raw) <= 200:
        raise bad_request("limit must be 1-200")
    return before, int(raw)


async def read(conn: Any, tenant_id: str | None, before: str | None, limit: int) -> dict[str, Any]:
    """Newest first. A tenant read relies on RLS for its scope: `conn` is in that tenant."""
    table = "platform_audit" if tenant_id is None else "audit"
    rows = await conn.fetch(
        f"SELECT * FROM {table} WHERE $1::text IS NULL OR (time, id) <"
        f" (SELECT time, id FROM {table} WHERE id = $1)"
        " ORDER BY time DESC, id DESC LIMIT $2",
        before,
        limit,
    )
    entries = [_entry(r, tenant_id) for r in rows]
    next_cursor = entries[-1]["id"] if len(entries) == limit else None
    return {"entries": entries, "next_cursor": next_cursor}


def check_append(body: Mapping[str, Any]) -> dict[str, Any]:
    """POST /internal/tenants/audit: the caller names its module; it never sets the actor flags."""
    module, action, target = body.get("module"), body.get("action"), body.get("target")
    if not isinstance(action, str) or not ACTION_RE.fullmatch(action):
        raise bad_request("action must be <module>.<noun>.<past-tense verb>")
    if not isinstance(module, str) or action.split(".")[0] != module:
        raise bad_request("module must equal the first part of action")
    if not (
        isinstance(target, dict)
        and isinstance(target.get("type"), str)
        and isinstance(target.get("id"), str)
    ):
        raise bad_request("target needs type and id")
    changes = body.get("changes", {})
    reason, correlation, user = (
        body.get("reason"),
        body.get("correlation_id"),
        body.get("actor_user_id"),
    )
    if not isinstance(changes, dict):
        raise bad_request("changes must be an object")
    for value, name in (
        (reason, "reason"),
        (correlation, "correlation_id"),
        (user, "actor_user_id"),
    ):
        if value is not None and not isinstance(value, str):
            raise bad_request(f"{name} must be a string")
    return {
        "module": module,
        "action": action,
        "target": {"type": target["type"], "id": target["id"]},
        "changes": changes,
        "reason": reason,
        "correlation_id": correlation,
        "actor_user_id": user,
    }
