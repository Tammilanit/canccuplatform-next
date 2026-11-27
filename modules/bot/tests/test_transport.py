"""The real websocket path, as on the CI stack: a client opens the fake Discord container's app
over TCP and reaches ready."""

from __future__ import annotations

import asyncio
import socket
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import uvicorn
from canccu_kit.testing.discord import Intents
from canccu_kit.testing.discord.server import create_server

from canccu_bot.client import DiscordClient
from canccu_bot.transport import connect_gateway

TOKEN = "fake-shared-token-for-tests-only-0123456789-0123456789"


@pytest.fixture
async def base() -> AsyncIterator[str]:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {
        "CANCCU_BOT_APPLICATION_ID": "100000000000000002",
        "CANCCU_BOT_TOKEN": TOKEN,
        "CANCCU_BOT_CLIENT_SECRET": "secret",
        "CANCCU_FAKE_DISCORD_GATEWAY_URL": f"ws://127.0.0.1:{port}/gateway",
    }
    _, app = create_server(env)
    server = uvicorn.Server(
        uvicorn.Config(
            app, host="127.0.0.1", port=port, log_level="warning", ws="websockets-sansio"
        )
    )
    task = asyncio.create_task(server.serve())
    for _ in range(200):
        if server.started:
            break
        await asyncio.sleep(0.01)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    await task


async def test_a_client_reaches_ready_over_a_real_websocket(base: str) -> None:
    async def ignore(event: str, data: dict[str, Any]) -> None:
        return None

    client = DiscordClient(
        "100000000000000002",
        TOKEN,
        http=httpx.AsyncClient(),
        api_url=f"{base}/api/v10",
        connector=connect_gateway,
        intents=Intents.GUILDS,
        on_status=lambda c: None,
        on_dispatch=ignore,
    )
    await client.start()
    for _ in range(300):
        if client.status["status"] == "ready":
            break
        await asyncio.sleep(0.01)
    assert client.status["status"] == "ready"
    async with httpx.AsyncClient() as http:
        assert (await http.get(f"{base}/_fake/sessions")).json() == {"100000000000000002": 1}
    await client.stop()
