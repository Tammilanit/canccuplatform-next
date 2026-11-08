from __future__ import annotations

import base64

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response
from starlette.routing import Route
from starlette.testclient import TestClient

from canccu_kit import OriginRefused, check_origin, event_page_csp, new_nonce
from canccu_kit.starlette import install

NONCE = "AAAAAAAAAAAAAAAAAAAAAA=="


def test_nonces_are_fresh_16_byte_values() -> None:
    first, second = new_nonce(), new_nonce()
    assert first != second
    assert len(base64.b64decode(first)) == 16


def test_the_surface_policy_is_the_contracts() -> None:
    assert event_page_csp(NONCE, "demo.example.org") == (
        "default-src 'none'; script-src 'self'; style-src 'self' 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='; "
        "img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; "
        "manifest-src 'self'; worker-src 'self'; "
        "frame-src https://demo.example.org/theming/sandbox/; object-src 'none'; "
        "base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
    )


def test_admin_and_sign_in_pages_cannot_be_framed() -> None:
    admin = event_page_csp(NONCE, "demo.example.org", page="admin")
    assert "frame-src 'self' https://demo.example.org/theming/sandbox/;" in admin
    assert admin.endswith("frame-ancestors 'none'")
    sign_in = event_page_csp(NONCE, "demo.example.org", page="sign_in")
    assert "frame-src https://demo.example.org/theming/sandbox/;" in sign_in
    assert sign_in.endswith("frame-ancestors 'none'")


def test_a_separate_sandbox_origin_replaces_the_path() -> None:
    csp = event_page_csp(NONCE, "demo.example.org", sandbox="https://demo.sandbox.example.net")
    assert "frame-src https://demo.sandbox.example.net;" in csp


@pytest.mark.parametrize(
    ("nonce", "host", "sandbox"),
    [
        ("short", "demo.example.org", None),
        ("AAAAAAAAAAAAAAAA'; script-src *", "demo.example.org", None),
        (NONCE, "demo.example.org; script-src *", None),
        (NONCE, "Demo.example.org", None),
        (NONCE, "demo.example.org", "https://x; script-src *"),
        (NONCE, "demo.example.org", "'unsafe-inline'"),
    ],
)
def test_values_that_could_change_the_policy_are_refused(
    nonce: str, host: str, sandbox: str | None
) -> None:
    with pytest.raises(ValueError):
        event_page_csp(nonce, host, sandbox=sandbox)


def refused(method: str, path: str, origin: str | None, sec: str | None = None) -> bool:
    try:
        check_origin(method, path, origin, "demo.example.org", sec)
    except OriginRefused as exc:
        assert (exc.status, exc.code) == (403, "origin_refused")
        return True
    return False


def test_origin_null_is_refused_on_the_api_whatever_the_method() -> None:
    assert refused("GET", "/api/screen/state", "null")
    assert refused("POST", "/api/screen/state", "null")
    # Sandbox files are fetched by opaque origins, which send Origin: null.
    assert not refused("GET", "/theming/sandbox/1/clock/app.js", "null")


def test_state_changing_requests_from_another_origin_are_refused() -> None:
    assert refused("POST", "/api/pizza/orders", "https://evil.example")
    assert refused("DELETE", "/settings/x", "https://demo.example.org.evil.example")
    assert refused("PUT", "/settings/x", "null")
    assert refused("POST", "/api/pizza/orders", None, "cross-site")
    assert not refused("POST", "/api/pizza/orders", "https://Demo.example.org")
    assert not refused("POST", "/api/pizza/orders", None)
    assert not refused("POST", "/api/pizza/orders", None, "same-origin")
    assert not refused("GET", "/api/pizza/menu", "https://evil.example")


def test_the_adapter_checks_every_request() -> None:
    async def write(request: Request) -> Response:
        return PlainTextResponse("ok")

    app = Starlette(routes=[Route("/api/x", write, methods=["GET", "POST"])])
    install(app)
    client = TestClient(app, base_url="http://demo.example.org")
    response = client.post("/api/x", headers={"origin": "https://evil.example"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_refused"
    assert client.get("/api/x", headers={"origin": "null"}).status_code == 403
    assert client.post("/api/x", headers={"origin": "http://demo.example.org"}).text == "ok"


def test_a_default_port_on_the_host_matches_an_origin_without_it() -> None:
    check_origin("POST", "/api/x", "https://demo.example.org", "demo.example.org:443")
    check_origin("POST", "/api/x", "http://192.0.2.1", "192.0.2.1:80")
    with pytest.raises(OriginRefused):
        check_origin("POST", "/api/x", "https://demo.example.org", "demo.example.org:8443")
