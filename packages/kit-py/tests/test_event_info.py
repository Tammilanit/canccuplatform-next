"""The event the organiser shell names in its header, as the tenants module tells anyone."""

from __future__ import annotations

import httpx

from canccu_kit.bus import Event
from canccu_kit.resolve import TenantResolver
from canccu_kit.ui import EventInfo

PUBLIC = {"id": "demo", "name": "Demo Event", "status": "live", "time_zone": "UTC", "venue": None}


def resolver(handler: httpx.MockTransport, clock: list[float]) -> TenantResolver:
    return TenantResolver(
        "http://tenants:8080", http=httpx.AsyncClient(transport=handler), now=lambda: clock[0]
    )


async def test_asks_the_public_api_for_the_request_s_host_and_caches() -> None:
    asked: list[tuple[str, str]] = []

    def answer(request: httpx.Request) -> httpx.Response:
        asked.append((request.url.path, request.headers["host"]))
        return httpx.Response(200, json=PUBLIC)

    clock = [0.0]
    r = resolver(httpx.MockTransport(answer), clock)
    assert await r.event("Demo.Localhost:8080") == EventInfo("Demo Event", "live", "UTC")
    assert await r.event("demo.localhost") is not None
    assert asked == [("/api/tenants/current", "demo.localhost")]
    r.handle_event(
        Event(
            id="e1",
            type="tenants.tenant.changed",
            version=1,
            time="2026-01-01T00:00:00Z",
            source="tenants",
            tenant="demo",
            data={},
        )
    )
    await r.event("demo.localhost")
    clock[0] = 31.0
    await r.event("demo.localhost")
    assert len(asked) == 3


async def test_a_failure_is_no_event_never_an_error() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    r = resolver(httpx.MockTransport(down), [0.0])
    assert await r.event("demo.localhost") is None
    r = resolver(httpx.MockTransport(lambda _: httpx.Response(503)), [0.0])
    assert await r.event("demo.localhost") is None


async def test_a_draft_event_is_asked_again_with_the_viewer_s_cookie_never_cached() -> None:
    asked: list[str | None] = []

    def answer(request: httpx.Request) -> httpx.Response:
        cookie = request.headers.get("cookie")
        asked.append(cookie)
        if cookie == "canccu_session=member":
            return httpx.Response(200, json={**PUBLIC, "status": "draft"})
        return httpx.Response(200, json={"id": "demo", "status": "draft"})

    r = resolver(httpx.MockTransport(answer), [0.0])
    member = await r.event("demo.localhost", "canccu_session=member")
    assert member is not None and member.name == "Demo Event"
    guest = await r.event("demo.localhost", "canccu_session=guest")
    assert guest is not None and guest.name is None
    assert await r.event("demo.localhost") == EventInfo(None, "draft", "UTC")
    # The shared answer once, then each viewer's own, which no other viewer is handed.
    assert asked == [None, "canccu_session=member", "canccu_session=guest"]


async def test_an_open_event_keeps_the_shared_answer_whatever_the_cookie() -> None:
    asked: list[str | None] = []

    def answer(request: httpx.Request) -> httpx.Response:
        asked.append(request.headers.get("cookie"))
        return httpx.Response(200, json=PUBLIC)

    r = resolver(httpx.MockTransport(answer), [0.0])
    await r.event("demo.localhost", "canccu_session=a")
    await r.event("demo.localhost", "canccu_session=b")
    assert asked == [None]
