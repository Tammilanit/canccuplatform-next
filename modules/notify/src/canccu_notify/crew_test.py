"""Send a test to the crew (#782 part C, plan D16, Q7; the lead's comment of 2026-11-23, item 2):
an urgent push to the devices of everyone admin names as holding a role, so an organiser sees
that notifications arrive. Never to all attendees: telling everyone is an announcement.

It is not a topic: never listed, configured or followed. Each recipient gets a personal
notification of its own (`crew_test`), so the hub can load what the push names, and it expires
within the hour."""

from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from canccu_kit import KitError, ServiceIdentity
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import delivery
from .access import tenant_of, topics_writer
from .deps import deps
from .web import event_of, redirect, writer_session

TOPIC = "crew_test"
COOLDOWN = timedelta(minutes=1)
EXPIRES = timedelta(hours=1)
BODY = "If you can read this, notifications reach this device."


class CrewReader:
    def __init__(self, admin_url: str, identity: ServiceIdentity) -> None:
        self.url = admin_url.rstrip("/") + "/internal/admin/people/with-role"
        self.identity = identity
        self.http = httpx.AsyncClient(timeout=5.0)

    async def role_holders(self, tenant_id: str) -> list[str]:
        response = await self.http.get(
            self.url, params={"tenant_id": tenant_id}, headers=self.identity.headers("admin")
        )
        response.raise_for_status()
        ids = response.json().get("user_ids")
        return [i for i in ids if isinstance(i, str)] if isinstance(ids, list) else []


async def run(request: Request) -> dict[str, int]:
    """Sends the test; the caller has checked the right. 429 within a minute of the last one."""
    d = deps(request)
    tenant = tenant_of(request)["tenant_id"]
    if d.crew is None:
        raise KitError("admin is not configured", status=503, code="unavailable")
    try:
        users = await d.crew.role_holders(tenant)
    except (httpx.HTTPError, ValueError) as exc:
        raise KitError("admin didn't answer", status=503, code="unavailable") from exc
    event = await event_of(request)
    title = f"Test from {event.name}" if event and event.name else "Test from the event"
    now = d.now()
    notes: list[str] = []
    async with d.db.tenant() as conn:
        # One a minute per event, claimed in the same transaction that makes the rows.
        claimed = await conn.fetchval(
            "INSERT INTO notify_source_state (crew_test_at) VALUES ($1) ON CONFLICT (tenant_id)"
            " DO UPDATE SET crew_test_at = EXCLUDED.crew_test_at"
            " WHERE notify_source_state.crew_test_at IS NULL"
            " OR notify_source_state.crew_test_at <= $2 RETURNING 1",
            now,
            now - COOLDOWN,
        )
        if claimed is None:
            raise KitError("one crew test a minute", status=429, code="rate_limited")
        subs = await conn.fetch(
            "SELECT id, user_id FROM notify_subscriptions WHERE user_id = ANY($1::text[])"
            " ORDER BY user_id, id",
            users,
        )
        rows: list[Any] = []
        made: dict[str, str] = {}
        for sub in subs:
            user = sub["user_id"]
            if user not in made:
                made[user] = secrets.token_urlsafe(16)
                await conn.execute(
                    "INSERT INTO notify_notifications (id, topic, part, audience, user_id, title,"
                    " body, urgent, channels, source_event_id, created_at, expires_at)"
                    " VALUES ($1, $2, 'personal', 'personal', $3, $4, $5, true, $6, $7, $8, $9)",
                    made[user],
                    TOPIC,
                    user,
                    title,
                    BODY,
                    ["push"],
                    f"crew-test:{now.isoformat()}",
                    now,
                    now + EXPIRES,
                )
            rows.append((made[user], f"user:{user}", "push", sub["id"], None, now))
        await delivery.queue(conn, rows)
        notes = list(made.values())
    await delivery.deliver(d, tenant)
    async with d.db.tenant() as conn:
        counts = dict(
            await conn.fetch(
                "SELECT status, count(*) FROM notify_deliveries"
                " WHERE notification_id = ANY($1::text[]) GROUP BY status",
                notes,
            )
        )
    return {
        "recipients": len(notes),
        "sent": int(counts.get("sent", 0)),
        "failed": int(counts.get("failed", 0)),
        # Pending or sending: deliver() takes only the oldest rows, so a backlog can hold ours.
        "queued": sum(int(n) for status, n in counts.items() if status not in ("sent", "failed")),
    }


async def crew_test_api(request: Request) -> Response:
    await topics_writer(request, write=True)
    return JSONResponse(await run(request))


async def crew_test_page(request: Request) -> Response:
    """The health box's button: sends, then says how it went on the page."""
    await writer_session(request)
    try:
        result = await run(request)
    except KitError as exc:
        if exc.status not in (429, 503):
            raise
        return redirect(f"?{urlencode({'tested': 'wait' if exc.status == 429 else 'down'})}#health")
    query = urlencode(
        {"tested": f"{result['recipients']}-{result['sent']}-{result['failed']}-{result['queued']}"}
    )
    return redirect(f"?{query}#health")


def tested_words(value: str) -> tuple[str, str] | None:
    """The notice after a test, as (kind, words); None for a value the page did not write."""
    if value == "wait":
        return "warn", "One test a minute: try again shortly."
    if value == "down":
        return "down", "Admin didn't answer, so nobody was tested. Try again shortly."
    try:
        people, sent, failed, queued = (int(n) for n in value.split("-"))
    except ValueError:
        return None
    if people == 0:
        return "warn", "Nobody with a role has allowed notifications on a device here yet."
    devices = sent + failed + queued
    words = (
        f"Test sent to {devices} {'device' if devices == 1 else 'devices'} of {people}"
        f" {'person' if people == 1 else 'people'}."
    )
    if failed:
        return "warn", f"{words} {failed} failed: the health box says why."
    if queued:
        return "ok", f"{words} {queued} on its way."
    return "ok", words


API_ROUTES = [Route("/api/notify/test/crew", crew_test_api, methods=["POST"])]
PAGE_ROUTES = [Route("/admin/topics/crew-test", crew_test_page, methods=["POST"])]
