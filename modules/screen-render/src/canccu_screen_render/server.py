"""The renderer's only door: a Unix socket in the `render-socket` volume (plan R3, R4).

One connection is one job, served one at a time, so the screen module's fair queue decides the
order. Protocol, all on one connection:
  request:  a JSON line {"op": "render", "size": N} then N bytes of deck, or {"op": "ping"}
  response: a JSON line {"ok": true, "slide_count", "warnings", "slides": [{index, width, height,
            bytes}]} followed by the PNGs in order; or {"ok": false, "error": {code, message}}.
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
from collections.abc import Callable
from pathlib import Path

from .convert import Cancelled, Rendered, StopCheck
from .inspect import Limits, RenderError, invalid

__all__ = ["Rendered", "serve"]

log = logging.getLogger("canccu_screen_render")
MAX_HEADER = 1024

RenderFn = Callable[[bytes, Path, StopCheck], Rendered]


def _png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as f:
        head = f.read(24)
    width, height = struct.unpack(">II", head[16:24])
    return width, height


def _closed(conn: socket.socket) -> StopCheck:
    def check() -> bool:
        readable, _, _ = select.select([conn], [], [], 0)
        return bool(readable) and conn.recv(1, socket.MSG_PEEK) == b""

    return check


class _Handler(socketserver.StreamRequestHandler):
    server: "_Server"

    def handle(self) -> None:
        try:
            header = json.loads(self.rfile.readline(MAX_HEADER))
            op = header.get("op") if isinstance(header, dict) else None
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
        deck = self.rfile.read(size)
        if len(deck) != size:
            self._error(invalid("The deck arrived incomplete. Upload it again."))
            return
        self.server.scratch.mkdir(parents=True, exist_ok=True)
        workdir = Path(tempfile.mkdtemp(dir=self.server.scratch))
        try:
            result = self.server.render(deck, workdir, _closed(self.connection))
            slides = [
                {"index": n, "width": w, "height": h, "bytes": p.stat().st_size}
                for n, p in enumerate(result.slides, start=1)
                for w, h in [_png_size(p)]
            ]
            self._send(
                {"ok": True, "slide_count": len(slides), "warnings": result.warnings,
                 "slides": slides}
            )  # fmt: skip
            for p in result.slides:
                with p.open("rb") as f:
                    shutil.copyfileobj(f, self.wfile)
        except RenderError as e:
            log.info("render refused: %s", e.code)
            self._error(e)
        except Cancelled:
            log.info("render cancelled by the caller")
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

    def _send(self, body: dict[str, object]) -> None:
        self.wfile.write(json.dumps(body).encode() + b"\n")

    def _error(self, e: RenderError) -> None:
        self._send({"ok": False, "error": {"code": e.code, "message": e.message}})


class _Server(socketserver.UnixStreamServer):
    def __init__(self, path: Path, render: RenderFn, limits: Limits, scratch: Path) -> None:
        self.render = render
        self.limits = limits
        self.scratch = scratch
        super().__init__(str(path), _Handler)


def serve(path: Path, render: RenderFn, limits: Limits, scratch: Path) -> _Server:
    path.unlink(missing_ok=True)
    server = _Server(path, render, limits, scratch)
    # The screen module runs as another user; the volume is shared with it alone.
    os.chmod(path, 0o666)
    return server
