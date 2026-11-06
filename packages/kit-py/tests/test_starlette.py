from __future__ import annotations

import json

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.testclient import TestClient

from canccu_kit import Bus, Health, RightsChecker
from canccu_kit.health import CheckResult
from canccu_kit.starlette import install, require_right
from canccu_kit.testing import MemoryStreamStore

from .conftest import FakeAdmin, json_response

state: dict[str, str] = {"valkey": "ok"}


async def valkey() -> CheckResult:
    return {"status": "ok"} if state["valkey"] == "ok" else {"status": "down", "detail": "x"}


def build(admin: FakeAdmin, store: MemoryStreamStore) -> Starlette:
    checker = RightsChecker(admin.client())
    bus = Bus(store, "screen")

    @require_right(checker, "screen.slides.edit")
    async def edit(request: Request) -> Response:
        await bus.publish("screen.slide.changed", {}, version=1)
        return JSONResponse({"user": request.state.session.user_id})

    async def crash(request: Request) -> Response:
        raise RuntimeError("secret detail")

    app = Starlette(routes=[Route("/edit", edit, methods=["POST"]), Route("/crash", crash)])
    install(app, Health("screen", "v0.1.0", {"valkey": valkey}))
    return app


def test_health_200_and_503(admin: FakeAdmin, store: MemoryStreamStore) -> None:
    client = TestClient(build(admin, store))
    state["valkey"] = "ok"
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    state["valkey"] = "down"
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["status"] == "down"
    state["valkey"] = "ok"


def test_rights_and_error_body(admin: FakeAdmin, store: MemoryStreamStore) -> None:
    admin.handler = lambda r: json_response(
        200,
        {
            "user": {"id": "u1", "name": "D"},
            "rights": ["screen.slides.edit"],
            "expires_at": "2999-01-01T00:00:00Z",
        },
    )
    client = TestClient(build(admin, store), raise_server_exceptions=False)

    response = client.post("/edit")
    assert response.status_code == 401
    assert response.json() == {"error": {"code": "not_signed_in", "message": "sign in first"}}

    response = client.post(
        "/edit", headers={"cookie": "canccu_session=s1", "x-correlation-id": "c-1"}
    )
    assert response.status_code == 200
    assert response.json() == {"user": "u1"}
    assert response.headers["x-correlation-id"] == "c-1"
    assert json.loads(store.calls[0].fields["event"])["correlation_id"] == "c-1"

    admin.handler = lambda r: json_response(
        200, {"user": {"id": "u2", "name": "E"}, "rights": [], "expires_at": "2999-01-01T00:00:00Z"}
    )
    response = client.post("/edit", headers={"cookie": "canccu_session=s2"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "missing_right"

    response = client.get("/nowhere")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"

    response = client.get("/crash")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "secret" not in response.text
