"""The health watch behind the Health page and the menu's note (docs/design/mockups.html,
sheet 4)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from canccu_kit import Health

from canccu_admin.health import Check, HealthWatch, Part
from canccu_admin.health_view import health_body

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


async def test_screen_rendering_stays_a_part_when_screens_do_not_say() -> None:
    clock = [T0]
    answers: dict[str, Any] = {"screen": None}
    watch, _ = watch_of(answers, clock)
    render = by_key(await watch.check())["screen-render"]
    assert render.status == "down" and render.down_since == T0
    assert render.detail == "Screens didn't answer, so rendering can't be checked"
    # Back with its render check: the renderer's "since" is cleared, not kept for the next failure.
    clock[0] = T0 + timedelta(seconds=10)
    answers["screen"] = {"status": "ok", "version": "v1", "checks": {"render": {"status": "ok"}}}
    assert by_key(await watch.check())["screen-render"].status == "ok"
    clock[0] = T0 + timedelta(seconds=20)
    answers["screen"] = {"status": "ok", "version": "v1", "checks": {}}
    check = await watch.check()
    render = by_key(check)["screen-render"]
    assert render.status == "down" and render.down_since == clock[0]
    assert render.detail == "Screens answered without a rendering check"
    assert len(check.parts) == 3  # admin, Screens and Screen rendering
    # Screens did answer: the page must not say "No answer" for its renderer.
    assert render.answer_ms is not None and render.answer_ms == by_key(check)["screen"].answer_ms
    _, body = health_body(check, "UTC")
    assert "No answer" not in body and ">no answer</td>" not in body


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


async def test_admin_itself_says_what_troubles_it() -> None:
    # Guards _probe_own reading its own answer the way it reads every other part's.
    async def valkey() -> dict[str, str]:
        return {"status": "down", "detail": "no answer"}

    own = Health("admin", "v1", {"valkey": valkey})
    watch = HealthWatch(own, {}, httpx.AsyncClient(), clock=lambda: T0)
    admin = by_key(await watch.check())["admin"]
    assert admin.status == "down" and admin.detail == "valkey: no answer"
    assert admin.version == "v1" and admin.answer_ms is not None


async def test_checks_asked_at_once_share_one_round_of_probes() -> None:
    # "Check now" pressed twice, or beside the loop's own check: one round, not one each.
    asked: list[str] = []
    release = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.host)
        await release.wait()
        return httpx.Response(200, json={"status": "ok", "version": "v1", "checks": {}})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    targets = {"agenda": "http://agenda/health"}
    watch = HealthWatch(Health("admin", "v1", {}), targets, http, clock=lambda: T0)
    first = asyncio.ensure_future(watch.check())
    second = asyncio.ensure_future(watch.check())
    await asyncio.sleep(0.01)
    release.set()
    a, b = await asyncio.gather(first, second)
    assert a is b and asked == ["agenda"]
    # Once it is done, the next check asks again.
    await watch.check()
    assert asked == ["agenda", "agenda"]


async def test_closing_the_watch_closes_its_http_client() -> None:
    http = httpx.AsyncClient()
    watch = HealthWatch(Health("admin", "v1", {}), {}, http, clock=lambda: T0)
    await watch.aclose()
    assert http.is_closed


def test_an_unknown_time_zone_reads_as_utc() -> None:
    check = Check(T0, (Part("notify", "down", down_since=T0),))
    description, body = health_body(check, "Nowhere/Atlantis")
    assert "Last check 18:39:00." in description
    assert "No answer since 18:39." in body
