from __future__ import annotations

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.testclient import TestClient

from canccu_kit import (
    SERVICE_HEADER,
    ConfigError,
    RightsChecker,
    ServiceForbidden,
    ServiceIdentity,
    ServiceUnauthenticated,
    service_has_right,
    service_key_from_env,
)
from canccu_kit.starlette import install, install_service_identity, require_right

from .conftest import FakeAdmin

KEY = b"k" * 32
NOW = 1_800_000_000.0


def identity(module: str, key: bytes = KEY, now: float = NOW) -> ServiceIdentity:
    return ServiceIdentity(module, key, now=lambda: now)


def token(caller: str, audience: str, **kw: float) -> str:
    return identity(caller, **kw).headers(audience)[SERVICE_HEADER]  # type: ignore[arg-type]


def test_a_token_for_this_module_names_its_caller() -> None:
    assert identity("tenants").verify(token("admin", "tenants")) == "admin"


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "garbage",
        "v2.admin.tenants.1800000060.x",
        "v1.Admin.tenants.1800000060.x",
        "v1.admin.tenants.soon.x",
    ],
)
def test_malformed_tokens_are_refused(value: str | None) -> None:
    with pytest.raises(ServiceUnauthenticated) as err:
        identity("tenants").verify(value)
    assert (err.value.status, err.value.code) == (401, "service_unauthenticated")


def test_a_token_for_another_audience_is_refused() -> None:
    with pytest.raises(ServiceUnauthenticated):
        identity("tenants").verify(token("admin", "screen"))


def test_a_tampered_caller_or_another_key_is_refused() -> None:
    good = token("admin", "tenants")
    with pytest.raises(ServiceUnauthenticated):
        identity("tenants").verify(good.replace("v1.admin.", "v1.screen.", 1))
    with pytest.raises(ServiceUnauthenticated):
        identity("tenants").verify(token("admin", "tenants", key=b"x" * 32))  # type: ignore[arg-type]


def test_expiry_and_far_future_tokens_are_refused() -> None:
    old = token("admin", "tenants", now=NOW - 61)
    with pytest.raises(ServiceUnauthenticated):
        identity("tenants").verify(old)
    assert identity("tenants").verify(token("admin", "tenants", now=NOW - 59)) == "admin"
    future = token("admin", "tenants", now=NOW + 300)
    with pytest.raises(ServiceUnauthenticated):
        identity("tenants").verify(future)


def test_require_checks_the_allow_list() -> None:
    value = token("screen", "notify")
    assert identity("notify").require(value, allowed={"screen"}) == "screen"
    with pytest.raises(ServiceForbidden) as err:
        identity("notify").require(value, allowed={"bot"})
    assert (err.value.status, err.value.code) == (403, "service_forbidden")


def test_a_non_canonical_expiry_is_refused() -> None:
    good = token("admin", "tenants")
    _, caller, audience, expires, sig = good.split(".")
    with pytest.raises(ServiceUnauthenticated):
        identity("tenants").verify(f"v1.{caller}.{audience}.0{expires}.{sig}")


def test_a_module_holds_only_its_own_rights() -> None:
    assert not service_has_right("screen", "screen.")
    assert service_has_right("screen", "screen.slides.edit")
    assert not service_has_right("screen", "admin.settings.read")
    assert not service_has_right("screen", "screens.x")


def test_the_key_comes_from_the_environment() -> None:
    assert service_key_from_env({"CANCCU_SERVICE_KEY": "a" * 32}) == b"a" * 32
    for env in ({}, {"CANCCU_SERVICE_KEY": "short"}):
        with pytest.raises(ConfigError):
            service_key_from_env(env)
    placeholder = {"CANCCU_SERVICE_KEY": "canccu-local-only-service-key-0123456789"}
    assert service_key_from_env({**placeholder, "CANCCU_VERSION": "dev"})
    with pytest.raises(ConfigError, match="placeholder"):
        service_key_from_env({**placeholder, "CANCCU_VERSION": "v1.0.0"})


def build(admin: FakeAdmin) -> Starlette:
    me = ServiceIdentity("tenants", KEY)

    async def internal(request: Request) -> Response:
        return JSONResponse({"caller": request.state.service})

    async def ask(request: Request) -> Response:
        return Response(status_code=200)

    @require_right(RightsChecker(admin.client()), "tenants.audit.read", service=me)
    async def api(request: Request) -> Response:
        return JSONResponse({"caller": getattr(request.state, "service", None)})

    app = Starlette(
        routes=[
            Route("/internal/tenants/resolve", internal),
            Route("/internal/tenants/ask", ask),
            Route("/api/tenants/audit", api),
        ]
    )
    install(app)
    install_service_identity(app, me, exempt=("/internal/tenants/ask",))
    return app


def test_internal_paths_need_a_service_identity(admin: FakeAdmin) -> None:
    client = TestClient(build(admin))
    response = client.get("/internal/tenants/resolve")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "service_unauthenticated"
    signed = ServiceIdentity("admin", KEY).headers("tenants")
    response = client.get("/internal/tenants/resolve", headers=signed)
    assert response.json() == {"caller": "admin"}
    assert client.get("/internal/tenants/ask").status_code == 200


def test_api_rights_accept_a_module_for_its_own_rights_only(admin: FakeAdmin) -> None:
    client = TestClient(build(admin))
    own = ServiceIdentity("tenants", KEY).headers("tenants")
    assert client.get("/api/tenants/audit", headers=own).json() == {"caller": "tenants"}
    other = ServiceIdentity("screen", KEY).headers("tenants")
    response = client.get("/api/tenants/audit", headers=other)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "missing_right"
    # Without the header the session check runs as before.
    assert client.get("/api/tenants/audit").status_code == 401
