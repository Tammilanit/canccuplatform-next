"""Where a module's page sends the browser back to after admin's sign-in."""

from __future__ import annotations

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response
from starlette.routing import Route
from starlette.testclient import TestClient

from canccu_kit.starlette import sign_in_return


async def back(request: Request) -> Response:
    return PlainTextResponse(sign_in_return(request, "/agenda", "/agenda/"))


APP = Starlette(
    routes=[
        Route("/items/{item_id}/edit", back, methods=["GET", "POST"]),
        Route("/undo/{undo_id}", back, methods=["POST"]),
    ]
)


def returns(method: str, url: str) -> str:
    text: str = TestClient(APP).request(method, url).text
    return text


def test_a_page_returns_to_itself_with_its_query() -> None:
    assert returns("GET", "/items/i1/edit?day=2026-11-10") == "/agenda/items/i1/edit?day=2026-11-10"


def test_a_post_returns_to_the_page_at_its_path() -> None:
    assert returns("POST", "/items/i1/edit?x=1") == "/agenda/items/i1/edit"


def test_a_post_with_no_page_at_its_path_returns_to_the_fallback() -> None:
    assert returns("POST", "/undo/u1") == "/agenda/"


def test_the_path_is_percent_encoded() -> None:
    assert returns("GET", "/items/a%20b%C3%A9/edit") == "/agenda/items/a%20b%C3%A9/edit"


def test_a_path_admin_would_refuse_returns_to_the_fallback() -> None:
    # Admin keeps a return path of at most 1024 printable ASCII characters (safe_return_path).
    long_id = "x" * 1024
    assert returns("GET", f"/items/{long_id}/edit") == "/agenda/"
    # A client sends the query as it likes; Starlette hands it on undecoded.
    odd = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/items/i1/edit",
            "app": APP,
            "query_string": b"q=\x01",
            "headers": [],
        }
    )
    assert sign_in_return(odd, "/agenda", "/agenda/") == "/agenda/"
    fits = "x" * (1024 - len("/agenda/items//edit"))
    assert returns("GET", f"/items/{fits}/edit") == f"/agenda/items/{fits}/edit"
