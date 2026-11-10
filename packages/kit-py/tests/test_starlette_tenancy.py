from __future__ import annotations

import asyncio
from typing import Literal

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route
from starlette.testclient import TestClient

from canccu_kit import Health, KitError
from canccu_kit.access import TenantContext
from canccu_kit.resolve import TenantResolver
from canccu_kit.starlette import install, install_tenancy
from canccu_kit.tenant import current_tenant

from .conftest import tenant_context

HOSTS: dict[str, TenantContext] = {
    "a.example.org": tenant_context(tenant_id="leak-a"),
    "b.example.org": tenant_context(tenant_id="leak-b"),
}


def tenants(request: httpx.Request) -> httpx.Response:
    ctx = HOSTS.get(request.url.params.get("host", ""))
    return httpx.Response(200, json=ctx) if ctx else httpx.Response(404, json={})


def resolver(handler: httpx.MockTransport | None = None) -> TenantResolver:
    return TenantResolver(
        "http://tenants",
        platform_hosts=["signin.example.org"],
        http=httpx.AsyncClient(transport=handler or httpx.MockTransport(tenants)),
    )


async def who(request: Request) -> Response:
    await asyncio.sleep(0.001)
    tenant: TenantContext | None = request.state.tenant
    return JSONResponse(
        {"context": tenant["tenant_id"] if tenant else None, "ctxvar": current_tenant()}
    )


def client(
    platform_hosts: Literal["serve", "refuse"] = "refuse",
    tenant_resolver: TenantResolver | None = None,
) -> TestClient:
    app = Starlette(routes=[Route("/who", who, methods=["GET", "POST"])])
    install(app, Health("pizza", "dev", {}))
    install_tenancy(app, tenant_resolver or resolver(), platform_hosts=platform_hosts)
    return TestClient(app, raise_server_exceptions=False)


def test_runs_each_request_in_the_tenant_of_its_host() -> None:
    c = client()
    for host, tenant in [("a.example.org", "leak-a"), ("B.example.org:80", "leak-b")]:
        response = c.get("/who", headers={"host": host})
        assert response.json() == {"context": tenant, "ctxvar": tenant}


def test_gives_an_unknown_host_404_with_no_detail() -> None:
    response = client().get("/who", headers={"host": "x.example.org", "x-correlation-id": "c-9"})
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Not found."}}
    assert response.headers["x-correlation-id"] == "c-9"


def test_answers_503_when_the_tenants_module_is_down() -> None:
    down = resolver(httpx.MockTransport(lambda r: httpx.Response(502)))
    response = client(tenant_resolver=down).get("/who", headers={"host": "a.example.org"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "tenants_unavailable"


def test_keeps_health_outside_tenant_resolution() -> None:
    c = client()
    assert c.get("/health", headers={"host": "x.example.org"}).status_code == 200
    assert c.head("/health", headers={"host": "x.example.org"}).status_code == 200
    assert c.post("/health", headers={"host": "x.example.org"}).status_code == 404


def test_refuses_the_platforms_own_hostnames_unless_the_module_serves_them() -> None:
    refused = client().get("/who", headers={"host": "signin.example.org"})
    assert refused.status_code == 404
    served = client("serve").get("/who", headers={"host": "signin.example.org"})
    assert served.json() == {"context": None, "ctxvar": None}


def page_errors(request: Request, exc: KitError) -> Response | None:
    if request.url.path != "/page":
        return None
    return HTMLResponse(f"<p>{exc.code}</p>", status_code=exc.status)


async def fails(request: Request) -> Response:
    raise KitError("admin unreachable", status=503, code="admin_unavailable")


def paged(tenant_resolver: TenantResolver | None = None) -> TestClient:
    routes = [Route(p, fails, methods=["GET", "POST"]) for p in ("/page", "/api")]
    app = Starlette(routes=routes)
    install(app, Health("pizza", "dev", {}), error_response=page_errors)
    install_tenancy(app, tenant_resolver or resolver(), error_response=page_errors)
    return TestClient(app, raise_server_exceptions=False)


def test_an_error_response_hook_renders_every_kit_error_of_a_page() -> None:
    down = resolver(httpx.MockTransport(lambda r: httpx.Response(502)))
    cases = [
        (paged(down).get("/page", headers={"host": "a.example.org"}), 503, "tenants_unavailable"),
        (paged().get("/page", headers={"host": "x.example.org"}), 404, "not_found"),
        (paged().get("/page", headers={"host": "a.example.org"}), 503, "admin_unavailable"),
        (
            paged().post(
                "/page", headers={"host": "a.example.org", "origin": "https://evil.example"}
            ),
            403,
            "origin_refused",
        ),
    ]
    for response, status, code in cases:
        assert response.status_code == status
        assert response.text == f"<p>{code}</p>"
    api = paged(down).get("/api", headers={"host": "a.example.org"})
    assert api.json()["error"]["code"] == "tenants_unavailable"
    assert paged().get("/api", headers={"host": "a.example.org"}).status_code == 503
