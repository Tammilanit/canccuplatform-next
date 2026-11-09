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
        head = json.loads(reply.readline())
        assert head["ok"], head
        assert [(x["width"], x["height"]) for x in head["slides"]] == [(2560, 1440)] * 2, head
        for slide in head["slides"]:
            png = reply.read(slide["bytes"])
            assert png.startswith(b"\x89PNG") and struct.unpack(">II", png[16:24]) == (2560, 1440)
        assert head["warnings"][0]["font"] == "FancyUnembedded", head
    print("smoke: 2 slides rendered through the socket")


if __name__ == "__main__":
    main()
