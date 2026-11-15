from __future__ import annotations

import json

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.testclient import TestClient

from canccu_kit import Bus, Health, KitError, RightsChecker
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
        await bus.publish("screen.slide.changed", {}, version=1, platform=True)
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


def page_app() -> Starlette:
    """A module with pages: its hook draws every page error, the API keeps the JSON body."""

    async def crash(request: Request) -> Response:
        raise RuntimeError("secret detail")

    async def form(request: Request) -> Response:
        return Response("ok")

    def hook(request: Request, exc: KitError) -> Response | None:
        if request.url.path.startswith("/api/"):
            return None
        return Response(f"page {exc.status} {exc.code}", status_code=exc.status)

    app = Starlette(
        routes=[
            Route("/crash", crash),
            Route("/api/crash", crash),
            Route("/form", form, methods=["POST"]),
        ]
    )
    install(app, error_response=hook)
    return app


def test_a_mistyped_page_address_is_drawn_by_the_hook() -> None:
    client = TestClient(page_app())
    response = client.get("/nowhere")
    assert (response.status_code, response.text) == (404, "page 404 not_found")
    assert client.get("/api/nowhere").json()["error"]["code"] == "not_found"


def test_a_wrong_method_on_a_page_is_drawn_by_the_hook() -> None:
    response = TestClient(page_app()).get("/form")
    assert response.status_code == 405 and response.text.startswith("page 405 ")


def test_an_uncaught_error_on_a_page_is_drawn_by_the_hook() -> None:
    client = TestClient(page_app(), raise_server_exceptions=False)
    response = client.get("/crash")
    assert (response.status_code, response.text) == (500, "page 500 internal_error")
    api = client.get("/api/crash")
    assert api.status_code == 500 and api.json()["error"]["code"] == "internal_error"
    assert "secret" not in api.text


def test_a_hook_that_fails_on_an_uncaught_error_falls_back_to_the_json_body() -> None:
    async def crash(request: Request) -> Response:
        raise RuntimeError("secret detail")

    def hook(request: Request, exc: KitError) -> Response | None:
        raise RuntimeError("the page broke too")

    app = Starlette(routes=[Route("/crash", crash)])
    install(app, error_response=hook)
    response = TestClient(app, raise_server_exceptions=False).get("/crash")
    assert response.status_code == 500 and response.json()["error"]["code"] == "internal_error"
