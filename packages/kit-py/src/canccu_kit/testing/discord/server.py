"""The fake Discord as a container for the CI stack (deploy/compose.ci.yml): the REST app, the
gateway on a websocket, and control paths for the stack tests. Never part of a real install.

It reads the shared application from the same variables the bot reads, so the two agree, and
seeds one guild with the bot in it."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from .fake import FakeDiscord
from .gateway import GatewayClosed


class _Socket:
    """A Starlette websocket as the gateway's Transport."""

    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws

    async def send(self, payload: dict[str, Any]) -> None:
        try:
            await self.ws.send_json(payload)
        except (WebSocketDisconnect, RuntimeError) as exc:
            raise GatewayClosed(1006) from exc

    async def recv(self) -> dict[str, Any]:
        try:
            message = await self.ws.receive_json()
        except WebSocketDisconnect as exc:
            raise GatewayClosed(exc.code) from exc
        except RuntimeError as exc:  # receive after the close
            raise GatewayClosed(1006) from exc
        return dict(message)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        try:
            await self.ws.close(code, reason)
        except RuntimeError:
            pass  # already closed


def create_server(env: Mapping[str, str]) -> tuple[FakeDiscord, Starlette]:
    fake = FakeDiscord(
        gateway_url=env.get("CANCCU_FAKE_DISCORD_GATEWAY_URL", "ws://fake-discord:8080/gateway")
    )
    app_id, token = env.get("CANCCU_BOT_APPLICATION_ID"), env.get("CANCCU_BOT_TOKEN")
    if app_id and token:
        shared = fake.add_application(
            "Demo Bot", id=app_id, token=token, client_secret=env.get("CANCCU_BOT_CLIENT_SECRET")
        )
        guild = fake.add_guild("Demo Community", bots=[shared.id])
        fake.add_channel(guild.id, "general")

    async def gateway(ws: WebSocket) -> None:
        await ws.accept()
        await fake.gateway.serve(_Socket(ws))

    async def sessions(request: Request) -> Response:
        return JSONResponse({a: fake.gateway.sessions_of(a) for a in fake.applications})

    async def dispatch(request: Request) -> Response:
        body = await request.json()
        sent = await fake.gateway.dispatch(str(body["application_id"]), str(body["t"]), body["d"])
        return JSONResponse({"sent": sent})

    async def health(request: Request) -> Response:
        return JSONResponse({"status": "ok"})

    routes = [
        *fake.rest_app().routes,
        WebSocketRoute("/gateway", gateway),
        Route("/_fake/sessions", sessions),
        Route("/_fake/dispatch", dispatch, methods=["POST"]),
        Route("/health", health),
    ]
    return fake, Starlette(routes=routes)


def main() -> None:
    import uvicorn

    _, app = create_server(os.environ)
    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="warning")
