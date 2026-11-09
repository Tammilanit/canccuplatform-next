import json
import socket
import threading
from pathlib import Path

import pytest

from canccu_screen_render.inspect import Limits, RenderError
from canccu_screen_render.server import Rendered, serve
from decks import png_header

PNG = png_header(4, 2) + b"rest"


def fake_render(deck: bytes, workdir: Path, should_stop) -> Rendered:
    if deck == b"bad":
        raise RenderError("file_invalid", "Not a deck.")
    if deck == b"boom":
        raise ValueError("internal detail")
    paths = []
    for n in (1, 2):
        p = workdir / f"slide-{n}.png"
        p.write_bytes(PNG)
        paths.append(p)
    return Rendered(slides=paths, warnings=[{"code": "font_missing"}])


@pytest.fixture
def sock(tmp_path):
    path = tmp_path / "render.sock"
    server = serve(path, fake_render, Limits(max_deck_bytes=1000), tmp_path / "scratch")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield path
    server.shutdown()
    server.server_close()


def call(path, header: dict, body: bytes = b"") -> tuple[dict, bytes]:
    with socket.socket(socket.AF_UNIX) as s:
        s.connect(str(path))
        s.sendall(json.dumps(header).encode() + b"\n" + body)
        s.shutdown(socket.SHUT_WR)
        data = b""
        while chunk := s.recv(65536):
            data += chunk
    head, _, rest = data.partition(b"\n")
    return json.loads(head), rest


def test_ping(sock):
    assert call(sock, {"op": "ping"})[0] == {"ok": True}


def test_render_returns_slides_after_the_header(sock):
    head, rest = call(sock, {"op": "render", "size": 4}, b"deck")
    assert head["ok"] and head["slide_count"] == 2
    assert head["warnings"] == [{"code": "font_missing"}]
    assert head["slides"] == [
        {"index": 1, "width": 4, "height": 2, "bytes": len(PNG)},
        {"index": 2, "width": 4, "height": 2, "bytes": len(PNG)},
    ]
    assert rest == PNG + PNG


def test_refusal_keeps_code_and_message(sock):
    head, _ = call(sock, {"op": "render", "size": 3}, b"bad")
    assert head == {"ok": False, "error": {"code": "file_invalid", "message": "Not a deck."}}


def test_unexpected_error_is_plain_renderer_failed(sock):
    head, _ = call(sock, {"op": "render", "size": 4}, b"boom")
    assert head["error"]["code"] == "renderer_failed"
    assert "internal detail" not in head["error"]["message"]


def test_too_big_deck_is_refused_before_reading(sock):
    head, _ = call(sock, {"op": "render", "size": 1001})
    assert head["error"]["code"] == "file_invalid" and "too large" in head["error"]["message"]


def test_short_body_and_garbage_header(sock):
    assert call(sock, {"op": "render", "size": 10}, b"abc")[0]["error"]["code"] == "file_invalid"
    assert call(sock, {"op": "dance"})[0]["ok"] is False


def test_scratch_is_emptied_after_each_job(sock, tmp_path):
    call(sock, {"op": "render", "size": 4}, b"deck")
    assert list((tmp_path / "scratch").iterdir()) == []


def test_ping_helper(sock, tmp_path):
    from canccu_screen_render.main import ping

    assert ping(sock) is True
    assert ping(tmp_path / "nobody.sock") is False
