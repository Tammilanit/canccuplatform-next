"""Start the renderer: `python -m canccu_screen_render.main`, or `--ping` for the healthcheck."""

import json
import logging
import os
import socket
import sys
from pathlib import Path

from .convert import render
from .inspect import Limits
from .server import serve

SOCKET = Path(os.environ.get("CANCCU_RENDER_SOCKET", "/run/canccu-render/render.sock"))
SCRATCH = Path(os.environ.get("CANCCU_RENDER_SCRATCH", "/tmp/canccu-render"))


def ping(path: Path) -> bool:
    try:
        with socket.socket(socket.AF_UNIX) as s:
            s.settimeout(3)
            s.connect(str(path))
            s.sendall(b'{"op": "ping"}\n')
            return bool(json.loads(s.makefile("rb").readline()).get("ok"))
    except (OSError, ValueError):
        return False


def main() -> None:
    if "--ping" in sys.argv:
        sys.exit(0 if ping(SOCKET) else 1)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    limits = Limits()
    server = serve(
        SOCKET, lambda deck, workdir, stop: render(deck, workdir, stop, limits), limits, SCRATCH
    )
    logging.getLogger("canccu_screen_render").info("listening on %s", SOCKET)
    server.serve_forever()


if __name__ == "__main__":
    main()
