"""The gateway's websocket: Discord's JSON payloads over `websockets`, its errors as the
gateway's own, so the shard sees a close code or a failed connection and nothing else."""

from __future__ import annotations

import json
from typing import Any

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidURI

from .gateway import GatewayClosed

MAX_PAYLOAD = 1 << 23
"""A large guild's GUILD_CREATE outgrows websockets' 1 MiB default."""


def _code(exc: ConnectionClosed) -> int | None:
    return exc.rcvd.code if exc.rcvd is not None else None


class WebSocketTransport:
    def __init__(self, ws: ClientConnection) -> None:
        self._ws = ws

    async def send(self, payload: dict[str, Any]) -> None:
        try:
            await self._ws.send(json.dumps(payload))
        except ConnectionClosed as exc:
            raise GatewayClosed(_code(exc)) from exc

    async def recv(self) -> dict[str, Any]:
        try:
            raw = await self._ws.recv()
        except ConnectionClosed as exc:
            raise GatewayClosed(_code(exc)) from exc
        message = json.loads(raw)
        return message if isinstance(message, dict) else {}

    async def close(self, code: int = 1000) -> None:
        await self._ws.close(code)


async def connect_gateway(url: str) -> WebSocketTransport:
    try:
        ws = await connect(url, max_size=MAX_PAYLOAD, open_timeout=30)
    except (InvalidHandshake, InvalidURI) as exc:
        raise OSError(f"gateway refused the connection: {exc}") from exc
    return WebSocketTransport(ws)
