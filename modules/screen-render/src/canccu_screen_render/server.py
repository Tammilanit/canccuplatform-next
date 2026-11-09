"""The renderer's only door: a Unix socket in the `render-socket` volume (plan R3, R4).

One connection is one request. Connections are served on threads so a ping (the healthcheck)
answers while a deck renders; renders themselves run one at a time, and the screen module's fair
queue decides their order. Protocol, all on one connection:
  request:  a JSON line {"op": "render", "size": N} then N bytes of deck, or {"op": "ping"}.
            The header and the deck must arrive within the read timeout (60 s).
  response: for each slide, a JSON line {"slide": {index, width, height, bytes}} then that many
            bytes of PNG; then one last JSON line, {"ok": true, "slide_count", "warnings"} or
            {"ok": false, "error": {code, message}} (an error may follow slides already sent:
            discard them). A ping gets {"ok": true}.
  Do not half-close the connection after the request: a closed read side means the caller left,
  and the job is cancelled.
The client must trust none of it: the process that wrote it parsed an untrusted file.
"""

import json
import logging
import os
import select
import shutil
import socket
import socketserver
import struct
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path

from .convert import Cancelled, Emit, StopCheck
from .fonts import Warning
from .inspect import Limits, RenderError, invalid

log = logging.getLogger("canccu_screen_render")
MAX_HEADER = 1024

RenderFn = Callable[[bytes, Path, StopCheck, Emit], list[Warning]]


def _png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as f:
        head = f.read(24)
    if not head.startswith(b"\x89PNG\r\n\x1a\n") or len(head) < 24:
        raise RenderError("renderer_failed", "A slide could not be drawn.")
    width, height = struct.unpack(">II", head[16:24])
    return width, height


def _closed(conn: socket.socket) -> StopCheck:
    def check() -> bool:
        try:
            readable, _, _ = select.select([conn], [], [], 0)
            return bool(readable) and conn.recv(1, socket.MSG_PEEK) == b""
        except OSError:
            return True

    return check


def _incomplete() -> RenderError:
    return invalid("The deck arrived incomplete. Upload it again.")


class _Handler(socketserver.StreamRequestHandler):
    server: "_Server"

    def handle(self) -> None:
        # Bounded reads: a caller that stalls mid-request must not hold the renderer.
        self.connection.settimeout(self.server.read_timeout)
        try:
            header = json.loads(self.rfile.readline(MAX_HEADER))
            op = header.get("op") if isinstance(header, dict) else None
        except TimeoutError:
            self._error(_incomplete())
            return
        except (ValueError, UnicodeDecodeError):
            op = None
        if op == "ping":
            self._send({"ok": True})
        elif op == "render" and isinstance(size := header.get("size"), int) and size > 0:
            self._render(size)
        else:
            self._error(RenderError("renderer_failed", "The render request was not understood."))

    def _render(self, size: int) -> None:
        limits = self.server.limits
        if size > limits.max_deck_bytes:
            mib = limits.max_deck_bytes // (1024 * 1024)
            self._error(invalid(f"The deck is too large; the limit is {mib} MiB."))
            return
        try:
            deck = self.rfile.read(size)
        except TimeoutError:
            deck = b""
        if len(deck) != size:
            self._error(_incomplete())
            return
        self.connection.settimeout(None)
        self.sent = 0
        with self.server.render_lock:
            self.server.scratch.mkdir(parents=True, exist_ok=True)
            workdir = Path(tempfile.mkdtemp(dir=self.server.scratch))
            try:
                warnings = self.server.render(deck, workdir, _closed(self.connection), self._emit)
                self._send({"ok": True, "slide_count": self.sent, "warnings": warnings})
            except RenderError as e:
                log.info("render refused: %s", e.code)
                self._error(e)
            except Cancelled:
                log.info("render cancelled: the caller left")
            except Exception:
                log.exception("render failed")
                self._error(
                    RenderError(
                        "renderer_failed",
                        "The deck could not be drawn. Open it in PowerPoint, save it again "
                        "(or export it as PDF) and upload that file.",
                    )
                )
            finally:
                shutil.rmtree(workdir, ignore_errors=True)

    def _emit(self, png: Path) -> None:
        width, height = _png_size(png)
        self.sent += 1
        slide = {"index": self.sent, "width": width, "height": height, "bytes": png.stat().st_size}
        try:
            self._send({"slide": slide})
            with png.open("rb") as f:
                shutil.copyfileobj(f, self.wfile)
        except OSError as e:  # the caller hung up mid-stream
            raise Cancelled from e
        png.unlink()

    def _send(self, body: dict[str, object]) -> None:
        self.wfile.write(json.dumps(body).encode() + b"\n")

    def _error(self, e: RenderError) -> None:
        try:
            self._send({"ok": False, "error": {"code": e.code, "message": e.message}})
        except OSError:
            log.info("render error not delivered: the caller left")


class _Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def __init__(
        self, path: Path, render: RenderFn, limits: Limits, scratch: Path, read_timeout: float
    ) -> None:
        self.render = render
        self.limits = limits
        self.scratch = scratch
        self.read_timeout = read_timeout
        self.render_lock = threading.Lock()
        super().__init__(str(path), _Handler)


def serve(
    path: Path, render: RenderFn, limits: Limits, scratch: Path, read_timeout: float = 60
) -> _Server:
    path.unlink(missing_ok=True)
    server = _Server(path, render, limits, scratch, read_timeout)
    # The screen module runs as another user; the volume is shared with it alone.
    os.chmod(path, 0o666)
    return server
