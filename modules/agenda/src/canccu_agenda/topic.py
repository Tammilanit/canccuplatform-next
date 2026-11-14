"""The `schedule` topic type, registered with Notify at start (contracts/notify.md, Topics and
sources; Registering). Without it Notify knows no topic for the agenda's events and sends nothing:
no reminders, no delay or cancel notices, no announcements (#517)."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from canccu_kit import ServiceIdentity

log = logging.getLogger("canccu_agenda.topic")

FIRST_PAUSE_S = 1.0
MAX_PAUSE_S = 60.0

_EVENT = {"field": "data.item.visibility"}
_CHANNELS = "data.item.notify_channels"
_NOT_QUIET = {"field": "data.item.kind", "op": "ne", "value": "quiet_hours"}
_SOON = {"field": "data.item.starts_at", "op": "within_minutes", "value": 120}
_PAGE = "/notify/agenda/{data.item.id}"

# Exactly the contract's JSON block; tests/test_topic.py holds the two together. A change here is
# a contract change (adding is additive, removing is breaking).
SCHEDULE: dict[str, Any] = {
    "key": "schedule",
    "owner": "agenda",
    "title": "Schedule",
    "description": "Reminders, delays, cancellations and announcements of the run-of-show",
    "parts": {
        "event": {
            "scope": "event",
            "channels": ["push", "discord_dm"],
            "defaults": {"push": True, "discord_dm": False},
        }
    },
    "params": [
        {
            "key": "lead_minutes",
            "type": "integer",
            "min": 1,
            "max": 1440,
            "default": 10,
            "description": "The reminder lead time that becomes a notification",
        }
    ],
    "triggers": [
        {
            "event": "agenda.reminder.triggered",
            "part": "event",
            "audience": _EVENT,
            "channels_field": _CHANNELS,
            "where": [
                _NOT_QUIET,
                {
                    "field": "data.lead_minutes",
                    "op": "nearest_in",
                    "list": "data.leads_minutes",
                    "param": "lead_minutes",
                },
            ],
            "title": "{data.item.title} at {data.item.starts_at|time}",
            "body": "Starts in {data.lead_minutes} min",
            "url": _PAGE,
            "expires_at": "data.item.starts_at",
        },
        {
            "event": "agenda.item.delayed",
            "part": "event",
            "audience": _EVENT,
            "channels_field": _CHANNELS,
            "where": [_NOT_QUIET, _SOON, {"field": "data.announce", "op": "eq", "value": True}],
            "dedupe_by": ["correlation_id", "audience"],
            "title": "{data.item.title} moved",
            "body": "Now at {data.item.starts_at|time} ({data.minutes|signed} min)",
            "url": _PAGE,
            "expires_at": "data.item.starts_at",
        },
        {
            "event": "agenda.item.cancelled",
            "part": "event",
            "audience": _EVENT,
            "channels_field": _CHANNELS,
            "where": [_NOT_QUIET, _SOON],
            "title": "{data.item.title} cancelled",
            "body": "Planned for {data.item.planned_starts_at|time}",
            "url": "/notify/agenda",
            "expires_at": "data.item.starts_at",
        },
        {
            "event": "agenda.item.announced",
            "part": "event",
            "audience": _EVENT,
            "channels_field": _CHANNELS,
            "where": [_NOT_QUIET],
            "title": "{data.item.title}",
            "body": "{data.message}",
            "url": _PAGE,
            "expires_at": "data.item.ends_at",
            "expires_after_minutes": 60,
        },
    ],
}


async def register(
    http: httpx.AsyncClient,
    notify_url: str,
    identity: ServiceIdentity,
    *,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """PUT the registration until Notify answers. Notify may start after the agenda or be down a
    while; the call is idempotent, so every container of every start sends it."""
    url = f"{notify_url.rstrip('/')}/internal/notify/topic-types/{SCHEDULE['key']}"
    pause = FIRST_PAUSE_S
    while True:
        try:
            response = await http.put(url, json=SCHEDULE, headers=identity.headers("notify"))
        except httpx.HTTPError as exc:
            problem = str(exc) or type(exc).__name__
        else:
            if response.status_code < 400:
                log.info("schedule topic registered with notify")
                return
            if response.status_code < 500:
                # Notify's own refusal (a bad registration, a key another module owns): the same
                # body would get the same answer. The agenda serves on; the error says why
                # phones hear nothing.
                log.error(
                    "notify refused the schedule topic: %s %s",
                    response.status_code,
                    response.text[:500],
                )
                return
            problem = f"HTTP {response.status_code}"
        log.warning("notify not reached (%s); registering again in %.0f s", problem, pause)
        await sleep(pause)
        pause = min(pause * 2, MAX_PAUSE_S)
