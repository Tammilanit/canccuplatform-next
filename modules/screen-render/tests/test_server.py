import json
import socket
import threading
import time
from pathlib import Path

import pytest

from canccu_screen_render.convert import Cancelled
from canccu_screen_render.inspect import Limits, RenderError
from canccu_screen_render.main import ping
from canccu_screen_render.server import serve
from decks import png_header

PNG = png_header(4, 2) + b"rest"


def fake_render(deck: bytes, workdir: Path, should_stop, emit) -> list:
    if deck == b"bad":
        raise RenderError("file_invalid", "Not a deck.")
    for n in (1, 2):
        p = workdir / f"slide-{n}.png"
        p.write_bytes(PNG)
        emit(p)
        assert not p.exists(), "each slide is deleted once sent"
    if deck == b"boom":
        raise ValueError("internal detail")
    if deck == b"slow":
        time.sleep(2)
    return [{"code": "font_missing"}]


def start(tmp_path, render=fake_render, **kwargs):
    path = tmp_path / "render.sock"
    server = serve(path, render, Limits(max_deck_bytes=1000), tmp_path / "scratch", **kwargs)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return path, server


@pytest.fixture
def sock(tmp_path):
    path, server = start(tmp_path)
    yield path
    server.shutdown()
    server.server_close()


def call(path, header: dict, body: bytes = b"") -> tuple[list[dict], list[bytes]]:
    """Every JSON line of the reply, and the PNGs that follow slide lines."""
    with socket.socket(socket.AF_UNIX) as s:
        s.connect(str(path))
        s.sendall(json.dumps(header).encode() + b"\n" + body)
        reply = s.makefile("rb")
        lines, pngs = [], []
        while line := reply.readline():
            msg = json.loads(line)
            lines.append(msg)
            if "slide" in msg:
                pngs.append(reply.read(msg["slide"]["bytes"]))
            else:
                break
    return lines, pngs


def test_ping(sock):
    assert call(sock, {"op": "ping"})[0] == [{"ok": True}]


def test_render_streams_each_slide_then_the_result(sock):
    lines, pngs = call(sock, {"op": "render", "size": 4}, b"deck")
    assert lines == [
        {"slide": {"index": 1, "width": 4, "height": 2, "bytes": len(PNG)}},
        {"slide": {"index": 2, "width": 4, "height": 2, "bytes": len(PNG)}},
        {"ok": True, "slide_count": 2, "warnings": [{"code": "font_missing"}]},
    ]
    assert pngs == [PNG, PNG]


def test_refusal_keeps_code_and_message(sock):
    lines, _ = call(sock, {"op": "render", "size": 3}, b"bad")
    assert lines == [{"ok": False, "error": {"code": "file_invalid", "message": "Not a deck."}}]


def test_error_after_slides_is_the_last_line(sock):
    lines, pngs = call(sock, {"op": "render", "size": 4}, b"boom")
    assert len(pngs) == 2 and lines[-1]["ok"] is False
    assert lines[-1]["error"]["code"] == "renderer_failed"
    assert "internal detail" not in lines[-1]["error"]["message"]


def test_too_big_deck_is_refused_before_reading(sock):
    [line], _ = call(sock, {"op": "render", "size": 1001})
    assert line["error"]["code"] == "file_invalid" and "too large" in line["error"]["message"]


def test_short_body_and_garbage_header(tmp_path):
    path, server = start(tmp_path, read_timeout=0.5)
    assert call(path, {"op": "render", "size": 10}, b"abc")[0][0]["error"]["code"] == "file_invalid"
    assert call(path, {"op": "dance"})[0][0]["ok"] is False
    server.shutdown()
    server.server_close()


def test_a_stalled_client_times_out_and_frees_the_renderer(tmp_path):
    path, server = start(tmp_path, read_timeout=0.5)
    with socket.socket(socket.AF_UNIX) as stalled:
        stalled.connect(str(path))
        stalled.sendall(b'{"op": "render", "size": 10}\nabc')  # 7 bytes short, then nothing
        reply = json.loads(stalled.makefile("rb").readline())
        assert (
            reply["error"]["code"] == "file_invalid" and "incomplete" in reply["error"]["message"]
        )
    assert call(path, {"op": "render", "size": 4}, b"deck")[0][-1]["ok"] is True
    server.shutdown()
    server.server_close()


def test_ping_answers_while_a_render_runs(tmp_path):
    path, server = start(tmp_path)
    worker = threading.Thread(target=call, args=(path, {"op": "render", "size": 4}, b"slow"))
    worker.start()
    time.sleep(0.3)
    started = time.monotonic()
    assert ping(path) is True
    assert time.monotonic() - started < 1
    worker.join()
    server.shutdown()
    server.server_close()


def test_scratch_is_emptied_after_each_job(sock, tmp_path):
    call(sock, {"op": "render", "size": 4}, b"deck")
    end = time.monotonic() + 2  # the server cleans up just after its last line
    while list((tmp_path / "scratch").iterdir()) and time.monotonic() < end:
        time.sleep(0.05)
    assert list((tmp_path / "scratch").iterdir()) == []


def test_ping_helper_without_a_server(tmp_path):
    assert ping(tmp_path / "nobody.sock") is False


def test_hanging_up_cancels_the_job(tmp_path):
    seen = threading.Event()

    def waits(deck, workdir, should_stop, emit):
        end = time.monotonic() + 5
        while time.monotonic() < end:
            if should_stop():
                seen.set()
                raise Cancelled
            time.sleep(0.05)
        raise AssertionError("never saw the hang-up")

    path, server = start(tmp_path, render=waits)
    with socket.socket(socket.AF_UNIX) as s:
        s.connect(str(path))
        s.sendall(b'{"op": "render", "size": 4}\ndeck')
        time.sleep(0.3)
    assert seen.wait(3)
    server.shutdown()
    server.server_close()
