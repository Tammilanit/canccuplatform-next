"""The acting token (contracts/admin.md, The acting token): a module takes it only beside the
bot's service identity, and admin answers the person's session for the tenant in scope, cut to
the token's module."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from canccu_kit import (
    ACTING_HEADER,
    SERVICE_HEADER,
    NotSignedIn,
    RightsChecker,
    ServiceForbidden,
    ServiceIdentity,
    ServiceUnauthenticated,
    tenant_scope,
)
from canccu_kit.starlette import install, require_right

from .conftest import FakeAdmin, json_response

KEY = b"kit-acting-tests-service-key-0123456789"
NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


def body(rights: list[str]) -> dict[str, object]:
    expires = (NOW + timedelta(seconds=60)).isoformat().replace("+00:00", "Z")
    return {"user": {"id": "u_7", "name": "Demo Crew"}, "rights": rights, "expires_at": expires}


def checker(admin: FakeAdmin, module: str = "pizza") -> RightsChecker:
    return RightsChecker(
        admin.client(), wall_clock=lambda: NOW, service=ServiceIdentity(module, KEY)
    )


def from_bot(audience: str = "pizza") -> dict[str, str]:
    return ServiceIdentity("bot", KEY).headers(audience)


async def test_the_session_comes_from_admin_for_the_tenant_in_scope(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(200, body(["pizza.order.manage"]))
    headers = {**from_bot(), ACTING_HEADER: "tok-1"}
    with tenant_scope("demo"):
        session = await checker(admin).from_headers(headers)
    assert (session.user_id, session.rights) == ("u_7", frozenset({"pizza.order.manage"}))
    assert session.superadmin is False
    sent = admin.requests[0]
    assert sent.url.path == "/internal/admin/acting-session"
    assert sent.url.params["tenant_id"] == "demo"
    assert sent.headers[ACTING_HEADER] == "tok-1"
    # The module signs its own call to admin; the bot's header never travels on.
    assert ServiceIdentity("admin", KEY).verify(sent.headers[SERVICE_HEADER]) == "pizza"
    assert "cookie" not in sent.headers


async def test_without_the_bots_identity_the_token_is_refused(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(200, body(["pizza.order.manage"]))
    with tenant_scope("demo"):
        with pytest.raises(ServiceUnauthenticated):  # a browser has no service key
            await checker(admin).from_headers({ACTING_HEADER: "tok-1"})
        with pytest.raises(ServiceForbidden):  # another module is not the bot
            other = ServiceIdentity("screen", KEY).headers("pizza")
            await checker(admin).from_headers({**other, ACTING_HEADER: "tok-1"})
        with pytest.raises(ServiceUnauthenticated):  # signed for another module
            await checker(admin).from_headers({**from_bot("moments"), ACTING_HEADER: "tok-1"})
    assert admin.requests == []


async def test_a_module_without_its_identity_or_a_tenant_takes_no_token(admin: FakeAdmin) -> None:
    plain = RightsChecker(admin.client(), wall_clock=lambda: NOW)
    with tenant_scope("demo"), pytest.raises(NotSignedIn):
        await plain.from_headers({**from_bot(), ACTING_HEADER: "tok-1"})
    with pytest.raises(NotSignedIn):  # no tenant in scope: nothing names the event
        await checker(admin).from_headers({**from_bot(), ACTING_HEADER: "tok-1"})
    assert admin.requests == []


async def test_a_token_admin_refuses_is_not_signed_in(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(
        401, {"error": {"code": "not_signed_in", "message": "expired"}}
    )
    with tenant_scope("demo"), pytest.raises(NotSignedIn):
        await checker(admin).from_headers({**from_bot(), ACTING_HEADER: "tok-1"})


async def test_acting_answers_are_never_cached(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(200, body(["pizza.order.manage"]))
    rights = checker(admin)
    with tenant_scope("demo"):
        for _ in range(2):
            await rights.from_headers({**from_bot(), ACTING_HEADER: "tok-1"})
    assert len(admin.requests) == 2


async def test_without_an_acting_header_the_cookie_still_decides(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(200, body(["pizza.order.manage"]))
    with tenant_scope("demo"):
        await checker(admin).from_headers({"cookie": "canccu_session=s1"})
    assert admin.requests[0].url.path == "/api/admin/session"


def app(rights: RightsChecker, service: ServiceIdentity | None) -> Starlette:
    @require_right(rights, "pizza.order.manage", service=service)
    async def endpoint(request: Request) -> Response:
        session = request.state.session
        return JSONResponse({"user": session.user_id if session else None})

    async def scoped(request: Request) -> Response:
        with tenant_scope("demo"):
            return await endpoint(request)

    application = Starlette(routes=[Route("/api/pizza/x", scoped)])
    install(application)
    return application


@pytest.mark.parametrize("with_service", [False, True])
async def test_require_right_acts_for_the_person(admin: FakeAdmin, with_service: bool) -> None:
    """Even where a module's own service calls pass (`service=`), the acting header wins: the
    call is the person's, with the person's rights, never the bot's own."""
    admin.handler = lambda r: json_response(200, body(["pizza.order.manage"]))
    identity = ServiceIdentity("pizza", KEY) if with_service else None
    transport = httpx.ASGITransport(app=app(checker(admin), identity))
    async with httpx.AsyncClient(transport=transport, base_url="http://pizza") as client:
        ok = await client.get("/api/pizza/x", headers={**from_bot(), ACTING_HEADER: "tok"})
        admin.handler = lambda r: json_response(200, body([]))
        refused = await client.get("/api/pizza/x", headers={**from_bot(), ACTING_HEADER: "tok"})
    assert (ok.status_code, ok.json()) == (200, {"user": "u_7"})
    assert refused.status_code == 403
