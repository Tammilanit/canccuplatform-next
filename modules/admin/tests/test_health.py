"""The health watch behind the Health page and the menu's note (docs/design/mockups.html,
sheet 4)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from canccu_kit import Health

from canccu_admin.health import Check, HealthWatch, Part

T0 = datetime(2026, 3, 14, 18, 39, tzinfo=UTC)


def watch_of(answers: dict[str, Any], clock: list[datetime]) -> tuple[HealthWatch, list[str]]:
    """A watch over one target per answer: a dict is the body, None never answers."""
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.host)
        body = answers[request.url.host]
        if body is None:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(503 if body["status"] == "down" else 200, json=body)

    targets = {name: f"http://{name}/health" for name in answers}
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    watch = HealthWatch(Health("admin", "v1", {}), targets, http, clock=lambda: clock[0])
    return watch, asked


def by_key(check: Check) -> dict[str, Part]:
    return {p.key: p for p in check.parts}


async def test_every_target_and_admin_itself_is_a_part_with_its_answer_time() -> None:
    ok = {"status": "ok", "version": "v1", "checks": {}}
    watch, _ = watch_of({"agenda": ok}, [T0])
    check = await watch.check()
    parts = by_key(check)
    assert set(parts) == {"admin", "agenda"} and check.at == T0
    assert parts["agenda"].status == "ok" and parts["agenda"].version == "v1"
    assert isinstance(parts["agenda"].answer_ms, int) and parts["admin"].answer_ms is not None


async def test_screen_rendering_is_a_part_of_its_own() -> None:
    # screen-render has no network: screen's `render` check speaks for it (contracts/screen.md).
    screen = {
        "status": "degraded",
        "version": "v1",
        "checks": {
            "postgres": {"status": "ok"},
            "render": {"status": "degraded", "detail": "the queue is 12 minutes old"},
        },
    }
    parts = by_key(await watch_of({"screen": screen}, [T0])[0].check())
    assert parts["screen-render"].status == "degraded"
    assert parts["screen-render"].detail == "the queue is 12 minutes old"
    assert parts["screen-render"].version == "v1"
    # Screens itself runs: only its renderer is slow.
    assert parts["screen"].status == "ok" and parts["screen"].detail == ""


async def test_screens_keep_their_own_trouble_beside_the_renderer() -> None:
    screen = {
        "status": "degraded",
        "version": "v1",
        "checks": {
            "valkey": {"status": "down", "detail": "no answer"},
            "render": {"status": "ok"},
        },
    }
    parts = by_key(await watch_of({"screen": screen}, [T0])[0].check())
    assert parts["screen"].status == "degraded" and parts["screen"].detail == "valkey: no answer"
    assert parts["screen-render"].status == "ok"


async def test_a_part_without_an_answer_is_down_since_its_first_failed_check() -> None:
    clock = [T0]
    answers: dict[str, Any] = {"notify": None}
    watch, _ = watch_of(answers, clock)
    first = by_key(await watch.check())["notify"]
    assert first.status == "down" and first.answer_ms is None and first.down_since == T0
    clock[0] = T0 + timedelta(seconds=10)
    assert by_key(await watch.check())["notify"].down_since == T0
    answers["notify"] = {"status": "ok", "version": "v1", "checks": {}}
    back = by_key(await watch.check())["notify"]
    assert back.status == "ok" and back.down_since is None


async def test_the_page_reuses_a_fresh_check() -> None:
    clock = [T0]
    watch, asked = watch_of({"agenda": {"status": "ok", "version": "v1", "checks": {}}}, clock)
    first = await watch.current()
    clock[0] = T0 + timedelta(seconds=5)
    assert await watch.current() is first and len(asked) == 1
    clock[0] = T0 + timedelta(seconds=25)
    assert (await watch.current()).at == clock[0] and len(asked) == 2


def test_the_menu_note_counts_the_parts_that_need_a_look() -> None:
    def check(*statuses: str) -> Check:
        return Check(T0, tuple(Part(f"p{i}", s) for i, s in enumerate(statuses)))

    assert check("ok", "ok").menu_note() is None
    assert check("ok", "degraded").menu_note() == ("degraded", "1 slow")
    assert check("down", "degraded", "down").menu_note() == ("down", "2 down, 1 slow")
    assert check("ok", "degraded", "down").counts() == {"ok": 1, "degraded": 1, "down": 1}
