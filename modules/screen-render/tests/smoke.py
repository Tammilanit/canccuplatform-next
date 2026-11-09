"""Smoke test against a running renderer, through its socket volume (CI's compose job).

    docker run --rm --network none -v <project>_render-socket:/run/canccu-render \
      canccu-screen-render-test python tests/smoke.py
"""

import json
import socket
import struct

from decks import pdf_pages

SOCKET = "/run/canccu-render/render.sock"


def main() -> None:
    deck = pdf_pages(2)
    with socket.socket(socket.AF_UNIX) as s:
        s.connect(SOCKET)
        s.sendall(json.dumps({"op": "render", "size": len(deck)}).encode() + b"\n" + deck)
        reply = s.makefile("rb")
        slides = 0
        while "slide" in (msg := json.loads(reply.readline())):
            png = reply.read(msg["slide"]["bytes"])
            assert png.startswith(b"\x89PNG") and struct.unpack(">II", png[16:24]) == (3840, 2160)
            slides += 1
        assert msg["ok"] and msg["slide_count"] == slides == 2, msg
        assert msg["warnings"][0]["font"] == "Fancy Unembedded", msg
    print("smoke: 2 slides rendered through the socket")


if __name__ == "__main__":
    main()
