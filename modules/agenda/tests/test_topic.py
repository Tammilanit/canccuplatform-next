"""The `schedule` topic type the agenda registers with Notify at start (contracts/notify.md,
Registering). No database: Notify is a fake transport."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx
from canccu_kit import ServiceIdentity

from canccu_agenda import topic

KEY = b"k" * 32
CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "notify.md"
URL = "http://notify:8080"


def contract_schedule() -> dict[str, Any]:
    text = CONTRACT.read_text()
    block = re.search(r"The `schedule` registration in full.*?```json\n(.*?)```", text, re.S)
    assert block is not None
    value: dict[str, Any] = json.loads(block.group(1))
    return value


class Notify:
    """Answers with the statuses given, in turn; a status of 0 is a connection refused."""

    def __init__(self, *statuses: int) -> None:
        self.statuses = list(statuses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status = self.statuses.pop(0)
        if status == 0:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(status, json={})


async def run(notify: Notify) -> list[float]:
    paused: list[float] = []

    async def pause(seconds: float) -> None:
        paused.append(seconds)

    http = httpx.AsyncClient(transport=httpx.MockTransport(notify))
    await topic.register(http, URL, ServiceIdentity("agenda", KEY), sleep=pause)
    return paused


def test_the_registration_is_the_contracts() -> None:
    assert topic.SCHEDULE == contract_schedule()


async def test_it_puts_the_schedule_type_signed_as_the_agenda() -> None:
    notify = Notify(200)
    assert await run(notify) == []
    [request] = notify.requests
    assert request.method == "PUT"
    assert str(request.url) == f"{URL}/internal/notify/topic-types/schedule"
    caller = ServiceIdentity("notify", KEY).verify(request.headers["x-canccu-service"])
    assert caller == "agenda"
    assert json.loads(request.content) == contract_schedule()


async def test_it_retries_until_notify_answers() -> None:
    notify = Notify(0, 502, 503, 0, 200)
    paused = await run(notify)
    assert len(notify.requests) == 5
    assert len(paused) == 4
    assert paused == sorted(paused)  # backs off, never faster


async def test_the_pause_stops_growing_at_a_minute() -> None:
    notify = Notify(*[0] * 12, 200)
    paused = await run(notify)
    assert max(paused) == topic.MAX_PAUSE_S
    assert topic.MAX_PAUSE_S <= 60


async def test_a_refused_registration_is_not_retried() -> None:
    # A 4xx is Notify's answer (a bad registration, a key another module owns): sending the same
    # body again cannot change it, and the agenda keeps serving.
    notify = Notify(409)
    assert await run(notify) == []
    assert len(notify.requests) == 1
