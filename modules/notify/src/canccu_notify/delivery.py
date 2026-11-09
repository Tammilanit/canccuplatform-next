"""Who gets a push, and sending it under the hourly cap (contracts/notify.md, Delivery rules).

The consumer writes one `notify_deliveries` row per phone inside the transaction that creates the
notification (`plan`), then sends at once (`deliver`). A loop in every container (`run`) sends
what a failed or crashed run left, visiting the events in `notify_delivery_tenants`. Rows are
claimed with FOR UPDATE SKIP LOCKED, so two containers never send one row; a crash after a send
and before the commit sends it again rather than never (plan D7).
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Any

from canccu_kit import tenant_scope

from .access import is_member
from .config import settings_ready
from .deps import Deps
from .push import GONE
from .subscriptions import keys_aad
from .webpush import payload

log = logging.getLogger("canccu_notify.delivery")
DEFAULT_CAP = 6
WINDOW = timedelta(minutes=60)
# Planners hold it shared until they commit; forgetting an idle event needs it alone, so an event
# is never dropped from the list while a planner's rows are not yet visible.
PLAN_LOCK = "hashtext('notify:deliveries:' || current_setting('canccu.tenant'))"


def person_wants_push(user_id: str | None, default: bool) -> bool:
    """The person's own channel choice for the part; a guest has only the phone's switches. Until
    choices can be stored (PATCH /api/notify/me, #226) every person has the part's default."""
    return user_id is None or default


async def plan(conn: Any, note: dict[str, Any], reg: dict[str, Any], now: datetime) -> int:
    """Rows for every phone the notification may reach; returns how many."""
    if "push" not in note["channels"]:
        return 0  # the type, the event's configuration or the source left push out
    part = note["part"]
    default = bool(reg["parts"][part]["defaults"].get("push", False))
    if part == "personal":
        subs = await conn.fetch(
            "SELECT id, user_id, preferences FROM notify_subscriptions WHERE user_id = $1",
            note["user_id"],
        )
    else:
        subs = await conn.fetch("SELECT id, user_id, preferences FROM notify_subscriptions")
    mode = await conn.fetchval("SELECT info_page_mode FROM notify_event_state")
    rows = []
    for sub in subs:
        user = sub["user_id"]
        if user is None and (note["audience"] != "public" or mode == "sign_in"):
            continue  # guests get public ones only, and none while the info pages are closed
        if user is not None and note["audience"] == "attendees" and not is_member(user):
            continue
        switch = json.loads(sub["preferences"]).get(note["topic"], {}).get(part, default)
        if not (switch and person_wants_push(user, default)):
            continue
        recipient = f"user:{user}" if user is not None else f"sub:{sub['id']}"
        rows.append((note["id"], recipient, sub["id"], now))
    if rows:
        await conn.execute(f"SELECT pg_advisory_xact_lock_shared({PLAN_LOCK})")
        await conn.executemany(
            "INSERT INTO notify_deliveries (notification_id, recipient, channel,"
            " subscription_id, created_at) VALUES ($1, $2, 'push', $3, $4)",
            rows,
        )
        await conn.execute(
            "INSERT INTO notify_delivery_tenants (tenant_id)"
            " VALUES (current_setting('canccu.tenant')) ON CONFLICT DO NOTHING"
        )
    return len(rows)


async def _cap(d: Deps) -> int:
    value = d.settings.get("hourly_cap", DEFAULT_CAP) if await settings_ready(d.settings) else None
    ok = isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 60
    return value if ok and isinstance(value, int) else DEFAULT_CAP


async def _decide(
    conn: Any, tenant: str, due: list[Any], cap: int, now: datetime
) -> tuple[list[Any], list[tuple[int, str]]]:
    """The rows to send now, and the rest with their final status.

    The cap counts notifications, not rows: a person's phones and channels for one notification
    count once. Each recipient's count is read under a lock on that recipient, taken in sorted
    order (no deadlock), so two containers cannot both send the cap's last place.
    """
    send: list[Any] = []
    done: list[tuple[int, str]] = []
    counted: dict[str, set[str]] = {}
    for recipient in sorted({r["recipient"] for r in due}):
        await conn.execute(
            "SELECT pg_advisory_xact_lock(hashtext($1))", f"notify:cap:{tenant}:{recipient}"
        )
        rows = await conn.fetch(
            "SELECT DISTINCT notification_id FROM notify_deliveries WHERE recipient = $1"
            " AND status = 'sent' AND done_at > $2",
            recipient,
            now - WINDOW,
        )
        counted[recipient] = {r["notification_id"] for r in rows}
    for row in due:
        seen = counted[row["recipient"]]
        if row["expires_at"] <= now:
            done.append((row["id"], "skipped"))
        elif row["notification_id"] in seen or row["urgent"] or len(seen) < cap:
            seen.add(row["notification_id"])  # urgent ones go over the cap and count toward it
            send.append(row)
        else:
            done.append((row["id"], "capped"))  # it stays in the inbox
    return send, done


async def deliver(d: Deps, tenant: str, *, batch: int = 100) -> int:
    """Send what is pending at one event; returns how many pushes went out."""
    cap = await _cap(d)
    now = d.now()
    async with d.db.tenant(tenant) as conn:
        due = await conn.fetch(
            "SELECT d.id, d.notification_id, d.recipient, d.subscription_id, n.topic, n.urgent,"
            " n.expires_at FROM notify_deliveries d JOIN notify_notifications n"
            " ON n.tenant_id = d.tenant_id AND n.id = d.notification_id"
            " WHERE d.status = 'pending' AND d.channel = 'push'"
            " ORDER BY d.id LIMIT $1 FOR UPDATE OF d SKIP LOCKED",
            batch,
        )
        send, done = await _decide(conn, tenant, list(due), cap, now)
        subs = {
            s["id"]: s
            for s in await conn.fetch(
                "SELECT id, endpoint, keys_sealed FROM notify_subscriptions"
                " WHERE id = ANY($1::text[])",
                [r["subscription_id"] for r in send],
            )
        }
        jobs = []
        for row in send:
            sub = subs.get(row["subscription_id"])
            if sub is None:
                done.append((row["id"], "skipped"))  # unsubscribed since
                continue
            keys = json.loads(d.box.open_text(sub["keys_sealed"], keys_aad(tenant, sub["id"])))
            body = payload(row["notification_id"], row["topic"], urgent=row["urgent"])
            jobs.append((row, sub, keys, body))
        answers = await asyncio.gather(
            *(
                d.push.send(
                    sub["endpoint"],
                    keys,
                    body,
                    urgent=row["urgent"],
                    expires_at=row["expires_at"],
                    now=now,
                )
                for row, sub, keys, body in jobs
            )
        )
        sent = 0
        gone: list[str] = []
        for (row, sub, _, _), status in zip(jobs, answers, strict=True):
            ok = 200 <= status < 300
            sent += ok
            done.append((row["id"], "sent" if ok else "failed"))
            if status in GONE:
                gone.append(sub["id"])
        await conn.executemany(
            "UPDATE notify_deliveries SET status = $2, done_at = $3 WHERE id = $1",
            [(i, status, now) for i, status in done],
        )
        if gone:
            # The push service says the browser unsubscribed: the subscription is gone.
            await conn.execute("DELETE FROM notify_subscriptions WHERE id = ANY($1::text[])", gone)
        if len(due) < batch:
            await _forget_if_idle(conn)
    return sent


async def _forget_if_idle(conn: Any) -> None:
    if await conn.fetchval(f"SELECT pg_try_advisory_xact_lock({PLAN_LOCK})") and not (
        await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM notify_deliveries WHERE status = 'pending')"
        )
    ):
        await conn.execute(
            "DELETE FROM notify_delivery_tenants WHERE tenant_id = current_setting('canccu.tenant')"
        )


async def tick(d: Deps) -> int:
    """Send what is pending at every event that has deliveries waiting."""
    async with d.db.platform() as conn:
        tenants = [
            r["tenant_id"]
            for r in await conn.fetch("SELECT tenant_id FROM notify_delivery_tenants ORDER BY 1")
        ]
    sent = 0
    for tenant in tenants:
        try:
            with tenant_scope(tenant):
                sent += await deliver(d, tenant)
        except Exception:
            log.exception("delivery failed", extra={"tenant": tenant})
    return sent


async def run(d: Deps, interval_seconds: float = 5.0) -> None:
    """The loop every container runs until cancelled."""
    while True:
        try:
            await tick(d)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("delivery tick failed")
        await asyncio.sleep(interval_seconds)
