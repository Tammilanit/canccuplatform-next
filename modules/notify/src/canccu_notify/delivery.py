"""Who gets a push, and sending pushes and DMs under the hourly cap and quiet hours
(contracts/notify.md, Delivery rules).

The consumer writes one `notify_deliveries` row per phone (`plan`) and per DM (dm.py) inside the
transaction that creates the notification, then sends at once (`deliver`). A loop in every
container (`run`) sends what a failed or crashed run left, and what quiet hours held once they
are over, visiting the events in `notify_delivery_tenants` (plan D7).

`deliver` claims rows with FOR UPDATE SKIP LOCKED and takes the quiet-hours and cap decisions in
one short transaction that marks them `sending`, sends with no transaction open (pushes; the
Discord id reads for DMs), then records the answers. A `sending` row older than LEASE was left by
a crash and is claimed again: sent twice rather than never.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Any

from canccu_kit import tenant_scope

from . import dm, people, quiet
from .access import is_member
from .config import settings_ready
from .deps import Deps
from .push import GONE
from .subscriptions import keys_aad
from .webpush import payload

log = logging.getLogger("canccu_notify.delivery")
DEFAULT_CAP = 6
WINDOW = timedelta(minutes=60)
LEASE = timedelta(minutes=5)
# Planners hold it shared until they commit; forgetting an idle event needs it alone, so an event
# is never dropped from the list while a planner's rows are not yet visible.
PLAN_LOCK = "hashtext('notify:deliveries:' || current_setting('canccu.tenant'))"


async def guests_closed(conn: Any) -> bool:
    """Whether guests' phones get nothing now: the info pages in mode `sign_in`, or the event a
    draft (the kit's check_info_access), as the last request on its hostname saw them."""
    state = await conn.fetchrow("SELECT info_page_mode, status FROM notify_event_state")
    return state is not None and (
        state["info_page_mode"] == "sign_in" or state["status"] == "draft"
    )


async def plan(
    conn: Any, note: dict[str, Any], default: bool, closed_to_guests: bool, now: datetime
) -> int:
    """Rows for every phone the notification may reach; returns how many. `default` is the part's
    push default as the event offers it (config.topic_info), the one subscriptions show."""
    if "push" not in note["channels"]:
        return 0  # the type, the event's configuration or the source left push out
    part = note["part"]
    if part == "personal":
        subs = await conn.fetch(
            "SELECT id, user_id, preferences FROM notify_subscriptions WHERE user_id = $1",
            note["user_id"],
        )
    else:
        subs = await conn.fetch("SELECT id, user_id, preferences FROM notify_subscriptions")
    found = await people.load(conn, [s["user_id"] for s in subs if s["user_id"] is not None])
    rows: list[dm.Row] = []
    for sub in subs:
        user = sub["user_id"]
        if user is None and (note["audience"] != "public" or closed_to_guests):
            continue  # guests get public ones only, and none while the info pages are closed
        if user is not None and note["audience"] == "attendees" and not is_member(user):
            continue
        switch = json.loads(sub["preferences"]).get(note["topic"], {}).get(part, default)
        # The phone and the person both: a guest has only the phone's switches.
        person = found.get(user, people.NOBODY) if user is not None else people.NOBODY
        if not (switch and person.wants(note["topic"], part, "push", default)):
            continue
        recipient = f"user:{user}" if user is not None else f"sub:{sub['id']}"
        rows.append((note["id"], recipient, "push", sub["id"], None, now))
    await queue(conn, rows)
    return len(rows)


async def queue(conn: Any, rows: list[dm.Row]) -> None:
    if not rows:
        return
    await conn.execute(f"SELECT pg_advisory_xact_lock_shared({PLAN_LOCK})")
    await conn.executemany(
        "INSERT INTO notify_deliveries (notification_id, recipient, channel, subscription_id,"
        " reason, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        rows,
    )
    await conn.execute(
        "INSERT INTO notify_delivery_tenants (tenant_id)"
        " VALUES (current_setting('canccu.tenant')) ON CONFLICT DO NOTHING"
    )


async def _settings(d: Deps) -> tuple[int, bool]:
    """The event's `hourly_cap` and `dm_fallback`, or their defaults while admin is down."""
    ready = await settings_ready(d.settings)
    cap = d.settings.get("hourly_cap") if ready else None
    if not (isinstance(cap, int) and not isinstance(cap, bool) and 1 <= cap <= 60):
        cap = DEFAULT_CAP
    return cap, event_fallback(d, ready)


def event_fallback(d: Deps, ready: bool) -> bool:
    return d.settings.get("dm_fallback", True) is not False if ready else True


async def _decide(
    conn: Any, tenant: str, due: list[Any], cap: int, held: bool, now: datetime
) -> tuple[list[Any], list[tuple[int, str]]]:
    """The rows to send now, and the rest with their final status (`held` while quiet hours run,
    for all but urgent ones).

    The cap counts notifications, not rows: a person's phones and channels for one notification
    count once, and rows being sent count as sent. Each recipient's count is read under a lock on
    that recipient, taken in sorted order (no deadlock) and held until the claim commits, so two
    containers cannot both send the cap's last place.
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
            " AND status IN ('sent', 'sending') AND done_at > $2",
            recipient,
            now - WINDOW,
        )
        counted[recipient] = {r["notification_id"] for r in rows}
    for row in due:
        seen = counted[row["recipient"]]
        if row["expires_at"] <= now:
            done.append((row["id"], "skipped"))
        elif held and not row["urgent"]:
            done.append((row["id"], "held"))
        elif row["notification_id"] in seen or row["urgent"] or len(seen) < cap:
            seen.add(row["notification_id"])  # urgent ones go over the cap and count toward it
            send.append(row)
        else:
            done.append((row["id"], "capped"))  # it stays in the inbox
    return send, done


async def _claim(
    d: Deps, conn: Any, tenant: str, batch: int, cap: int, now: datetime
) -> tuple[list[Any], list[Any], list[str], int]:
    """The pushes to send, each with its subscription's opened keys, the DMs, and the
    notifications of pushes that failed here (for the DM fallback); marks them `sending`."""
    held = await quiet.active(conn, now)
    if not held:
        await quiet.release(conn, now)
    # A recipient who would get both a custom topic's notification and its base's for one source
    # event gets only the custom one (contracts/notify.md, Custom topics), as the inbox's collapse.
    # Both are planned in the consumer's one transaction, so the custom row is there to be seen.
    await conn.execute(
        "UPDATE notify_deliveries b SET status = 'skipped', done_at = $1"
        " FROM notify_notifications bn, notify_deliveries c, notify_notifications cn"
        " WHERE b.status = 'pending' AND bn.tenant_id = b.tenant_id AND bn.id = b.notification_id"
        " AND c.tenant_id = b.tenant_id AND c.recipient = b.recipient AND c.channel = b.channel"
        " AND cn.tenant_id = c.tenant_id AND cn.id = c.notification_id"
        " AND cn.based_on = bn.topic AND cn.source_event_id = bn.source_event_id",
        now,
    )
    due = await conn.fetch(
        "SELECT d.id, d.notification_id, d.recipient, d.channel, d.subscription_id, d.reason,"
        " n.topic, n.title, n.body, n.url, n.urgent, n.expires_at"
        " FROM notify_deliveries d JOIN notify_notifications n"
        " ON n.tenant_id = d.tenant_id AND n.id = d.notification_id"
        " WHERE (d.status = 'pending' OR (d.status = 'sending' AND d.done_at < $2))"
        " ORDER BY d.id LIMIT $1 FOR UPDATE OF d SKIP LOCKED",
        batch,
        now - LEASE,
    )
    done: list[tuple[int, str]] = []
    if any(r["channel"] == dm.DM for r in due) and not await dm.can_send(conn):
        # The bot stopped since they were planned: none goes out, and none takes a cap place.
        done = [(r["id"], "skipped") for r in due if r["channel"] == dm.DM]
        due = [r for r in due if r["channel"] != dm.DM]
    send, decided = await _decide(conn, tenant, list(due), cap, held, now)
    done += decided
    dms = [r for r in send if r["channel"] == dm.DM]
    send = [r for r in send if r["channel"] != dm.DM]
    done += [(r["id"], "sending") for r in dms]
    subs = {
        s["id"]: s
        for s in await conn.fetch(
            "SELECT id, endpoint, keys_sealed FROM notify_subscriptions WHERE id = ANY($1::text[])",
            [r["subscription_id"] for r in send],
        )
    }
    jobs = []
    lost: list[str] = []
    for row in send:
        sub = subs.get(row["subscription_id"])
        if sub is None:
            done.append((row["id"], "skipped"))  # unsubscribed since
            lost.append(row["notification_id"])
            continue
        try:
            keys = json.loads(d.secrets.open_text(sub["keys_sealed"], keys_aad(tenant, sub["id"])))
        except Exception:
            # One row that does not open (a lost key, a damaged value) must not stop the event.
            log.exception("push keys do not open", extra={"tenant": tenant})
            done.append((row["id"], "failed"))
            lost.append(row["notification_id"])
            continue
        jobs.append((row, sub, keys))
        done.append((row["id"], "sending"))
    await conn.executemany(
        "UPDATE notify_deliveries SET status = $2, done_at = $3 WHERE id = $1",
        [(i, status, now) for i, status in done],
    )
    return jobs, dms, lost, len(due)


async def deliver(d: Deps, tenant: str, *, batch: int = 100) -> int:
    """Send what is pending at one event; returns how many pushes and DMs went out."""
    cap, fallback = await _settings(d)
    sent = 0
    for _ in range(2):  # the second pass sends the DM fallbacks of pushes that all failed
        count, more = await _pass(d, tenant, batch, cap, fallback)
        sent += count
        if not more:
            break
    return sent


async def _pass(d: Deps, tenant: str, batch: int, cap: int, fallback: bool) -> tuple[int, bool]:
    now = d.now()
    async with d.db.tenant(tenant) as conn:
        jobs, dms, failed, claimed = await _claim(d, conn, tenant, batch, cap, now)
    ids = await dm.discord_ids(d, tenant, {r["recipient"].removeprefix("user:") for r in dms})
    answers = await asyncio.gather(
        *(
            d.push.send(
                sub["endpoint"],
                keys,
                payload(row["notification_id"], row["topic"], urgent=row["urgent"]),
                urgent=row["urgent"],
                expires_at=row["expires_at"],
                now=now,
            )
            for row, sub, keys in jobs
        ),
        return_exceptions=True,
    )
    sent = 0
    done: list[tuple[int, str]] = []
    gone: list[str] = []
    for (row, sub, _), answer in zip(jobs, answers, strict=True):
        if isinstance(answer, BaseException):
            log.error("push failed: %s", type(answer).__name__, extra={"tenant": tenant})
            answer = 0
        ok = 200 <= answer < 300
        sent += ok
        done.append((row["id"], "sent" if ok else "failed"))
        if not ok:
            failed.append(row["notification_id"])
        if answer in GONE:
            gone.append(sub["id"])
    async with d.db.tenant(tenant) as conn:
        requested = await dm.request(d, conn, dms, ids)
        sent += sum(status == "sent" for _, status in requested)
        await conn.executemany(
            "UPDATE notify_deliveries SET status = $2, done_at = $3"
            " WHERE id = $1 AND status = 'sending'",
            [(i, status, now) for i, status in done + requested],
        )
        if gone:
            # The push service says the browser unsubscribed: the subscription is gone.
            await conn.execute("DELETE FROM notify_subscriptions WHERE id = ANY($1::text[])", gone)
        more = await dm.fallbacks(conn, sorted(set(failed)), fallback, now)
        await queue(conn, more)
        if claimed < batch and not more:
            await _forget_if_idle(conn)
    if dms:
        await d.outbox.flush(tenant)
    return sent, bool(more)


async def _forget_if_idle(conn: Any) -> None:
    if await conn.fetchval(f"SELECT pg_try_advisory_xact_lock({PLAN_LOCK})") and not (
        await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM notify_deliveries"
            " WHERE status IN ('pending', 'sending', 'held'))"
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
