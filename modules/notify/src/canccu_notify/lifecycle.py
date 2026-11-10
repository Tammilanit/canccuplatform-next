"""The event's lifecycle and retention (contracts/notify.md, Tenancy): the archive deletes every
person's data at once and stops delivery; check-ins, presence data, go with the presence
retention 30 days later."""

from __future__ import annotations

from canccu_kit import Event

from .deps import Deps

PERSONAL = (
    "notify_deliveries", "notify_notifications", "notify_subscriptions", "notify_people",
    "notify_follows", "notify_check_in_keys", "notify_dedupe",
)  # fmt: skip
"""Deleted on the archive: subscriptions and their tokens, choices, follows, notifications and
their deliveries, the check-in key (plan D5), and the dedupe keys, which carry values of the
source events (a user id among them, for a trigger that dedupes by one)."""


async def handle(d: Deps, event: Event) -> None:
    """A tenants event, inside its tenant scope."""
    tenant = event.tenant
    if tenant is None:
        return
    if event.type == "tenants.status.changed" and event.data.get("to") == "archived":
        await archive(d, tenant)
    # A module ignores a data class it does not know. `personal` (12 months) finds nothing but
    # check-ins left over from a missed `presence`.
    elif event.type == "tenants.retention.reached" and event.data.get("data_class") in (
        "presence",
        "personal",
    ):
        async with d.db.tenant(tenant) as conn:
            await conn.execute("DELETE FROM notify_check_ins")


async def archive(d: Deps, tenant: str) -> None:
    async with d.db.tenant(tenant) as conn:
        # The consumer makes nothing for an archived event; a request on its hostname later
        # writes the same status (access.tenant_ctx). UTC is what a row-less event uses anyway.
        await conn.execute(
            "INSERT INTO notify_event_state (time_zone, status) VALUES ('UTC', 'archived')"
            " ON CONFLICT (tenant_id) DO UPDATE SET status = 'archived'"
        )
        # Not personal, but nothing reads them for an archived event, and start-up would read
        # its agenda again every time.
        for table in (*PERSONAL, "notify_quiet_hours", "notify_source_state"):
            await conn.execute(f"DELETE FROM {table}")
        await conn.execute(
            "DELETE FROM notify_agenda_tenants WHERE tenant_id = current_setting('canccu.tenant')"
        )
    d.check_in_keys.pop(tenant, None)
