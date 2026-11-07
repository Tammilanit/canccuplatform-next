from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from canccu_kit import (
    AdminUnavailable,
    MissingRight,
    NotSignedIn,
    RightsChecker,
    session_id_from_cookie,
)
from canccu_kit.bus import Event

from .conftest import FakeAdmin, json_response

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def session_body(rights: list[str], expires: datetime | None = None) -> dict[str, object]:
    return {
        "user": {"id": "u1", "name": "Demo User"},
        "rights": rights,
        "expires_at": (expires or NOW + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
    }


def make(admin: FakeAdmin, clock: Clock) -> RightsChecker:
    return RightsChecker(admin.client(), clock=clock, wall_clock=lambda: NOW)


def rights_changed(user_id: str) -> Event:
    return Event(
        "r1",
        "admin.rights.changed",
        1,
        "2026-01-01T12:00:00Z",
        "admin",
        {"user_id": user_id, "rights": [], "actor_user_id": "u0"},
    )


def test_cookie_parsing() -> None:
    assert session_id_from_cookie("a=1; canccu_session=abc; b=2") == "abc"
    assert session_id_from_cookie("canccu_session_x=abc") is None
    assert session_id_from_cookie(None) is None


async def test_allowed_and_forwards_only_session_cookie(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(200, session_body(["screen.slides.edit"]))
    session = await make(admin, Clock()).check(
        "theme=dark; canccu_session=s1", "screen.slides.edit"
    )
    assert session.user_id == "u1"
    [request] = admin.requests
    assert request.url.path == "/api/admin/session"
    assert request.headers["cookie"] == "canccu_session=s1"


async def test_no_cookie_is_401_without_admin_call(admin: FakeAdmin) -> None:
    with pytest.raises(NotSignedIn) as info:
        await make(admin, Clock()).check("theme=dark", "screen.slides.edit")
    assert (info.value.status, info.value.code) == (401, "not_signed_in")
    assert admin.requests == []


async def test_admin_401_is_not_signed_in_and_not_cached(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(
        401, {"error": {"code": "not_signed_in", "message": "x"}}
    )
    checker = make(admin, Clock())
    for _ in range(2):
        with pytest.raises(NotSignedIn):
            await checker.check("canccu_session=gone", "screen.slides.edit")
    assert len(admin.requests) == 2


async def test_missing_right_is_403(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(200, session_body(["screen.slides.view"]))
    with pytest.raises(MissingRight) as info:
        await make(admin, Clock()).check("canccu_session=s1", "screen.slides.edit")
    assert (info.value.status, info.value.code) == (403, "missing_right")


async def test_cache_lasts_at_most_30_seconds(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(200, session_body(["screen.slides.edit"]))
    clock = Clock()
    checker = make(admin, clock)
    await checker.check("canccu_session=s1", "screen.slides.edit")
    clock.t += 29.9
    await checker.check("canccu_session=s1", "screen.slides.edit")
    assert len(admin.requests) == 1
    clock.t += 0.2
    await checker.check("canccu_session=s1", "screen.slides.edit")
    assert len(admin.requests) == 2


async def test_cache_never_outlives_session(admin: FakeAdmin) -> None:
    expires = NOW + timedelta(seconds=5)
    admin.handler = lambda r: json_response(200, session_body(["a.b"], expires))
    clock = Clock()
    checker = make(admin, clock)
    await checker.check("canccu_session=s1", "a.b")
    clock.t += 6
    await checker.check("canccu_session=s1", "a.b")
    assert len(admin.requests) == 2


async def test_rights_changed_drops_users_entries(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(200, session_body(["screen.slides.edit"]))
    checker = make(admin, Clock())
    await checker.check("canccu_session=s1", "screen.slides.edit")
    await checker.check("canccu_session=s2", "screen.slides.edit")
    await checker.handle_event(rights_changed("someone_else"))
    await checker.check("canccu_session=s1", "screen.slides.edit")
    assert len(admin.requests) == 2

    admin.handler = lambda r: json_response(200, session_body([]))
    await checker.handle_event(rights_changed("u1"))
    for sid in ("s1", "s2"):
        with pytest.raises(MissingRight):
            await checker.check(f"canccu_session={sid}", "screen.slides.edit")
    assert len(admin.requests) == 4


async def test_forget_session_drops_only_that_session(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(200, session_body(["a.b"]))
    checker = make(admin, Clock())
    await checker.check("canccu_session=s1", "a.b")
    await checker.check("canccu_session=s2", "a.b")
    checker.forget_session("s1")
    checker.forget_session("never-seen")
    admin.handler = lambda r: json_response(
        401, {"error": {"code": "not_signed_in", "message": "x"}}
    )
    with pytest.raises(NotSignedIn):
        await checker.check("canccu_session=s1", "a.b")
    await checker.check("canccu_session=s2", "a.b")  # still cached
    assert len(admin.requests) == 3


async def test_admin_down_is_503(admin: FakeAdmin) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    admin.handler = refuse
    with pytest.raises(AdminUnavailable) as info:
        await make(admin, Clock()).check("canccu_session=s1", "a.b")
    assert (info.value.status, info.value.code) == (503, "admin_unavailable")

    admin.handler = lambda r: httpx.Response(502)
    with pytest.raises(AdminUnavailable):
        await make(admin, Clock()).check("canccu_session=s1", "a.b")
