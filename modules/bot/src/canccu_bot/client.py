"""One client: one application's REST side and its gateway shards, with the one status the
contract shows for both (contracts/bot.md, The event's connection)."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx

from .gateway import Connector, Dispatch, GatewayShard, backoff
from .rest import RestClient, RestError

log = logging.getLogger("canccu_bot.client")

IDENTIFY_SPACING_S = 5.0
"""Discord lets `max_concurrency` shards identify per 5 seconds."""


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class DiscordClient:
    def __init__(
        self,
        application_id: str,
        token: str,
        *,
        http: httpx.AsyncClient,
        api_url: str,
        connector: Connector,
        intents: int,
        on_status: Callable[[DiscordClient], None],
        on_dispatch: Dispatch,
        rest_options: dict[str, Any] | None = None,
        on_stop: Callable[[], None] = lambda: None,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.application_id = application_id
        self._token = token
        self._http = http
        self._connector = connector
        self._intents = intents
        self._on_status = on_status
        self._on_dispatch = on_dispatch
        self._on_stop = on_stop
        self._now = now
        self._sleep = sleep
        self.rest = RestClient(token, http=http, api_url=api_url, **(rest_options or {}))
        self.rest.on_change = self._changed
        self._shards: list[GatewayShard] = []
        self._tasks: list[asyncio.Task[None]] = []
        self._gateway_url = ""
        self._unreachable = False
        self._current: tuple[str, str | None] = ("connecting", None)
        self._since = now()

    @property
    def status(self) -> dict[str, Any]:
        status, error_code = self._current
        return {"status": status, "error_code": error_code, "since": iso(self._since)}

    @property
    def bot_user(self) -> dict[str, str] | None:
        return next((s.bot_user for s in self._shards if s.bot_user is not None), None)

    async def start(self) -> None:
        """Opens the client in the background; its status says how far it got."""
        self._tasks.append(asyncio.create_task(self._open()))

    async def _open(self) -> None:
        waits = 0
        while True:
            try:
                info = await self.rest.request("GET", "/gateway/bot")
                break
            except RestError as exc:
                if exc.code in ("token_invalid", "invalid_requests"):
                    return  # the REST side's status says it
                self._unreachable = True
                self._changed()
                await self._sleep(backoff(waits))
                waits += 1
        self._unreachable = False
        self._gateway_url = str(info["url"])
        count = int(info.get("shards") or 1)
        per_window = int((info.get("session_start_limit") or {}).get("max_concurrency") or 1)
        for index in range(count):
            shard = GatewayShard(
                self._token,
                self._intents,
                connector=self._connector,
                gateway_url=self._url,
                on_dispatch=self._on_dispatch,
                on_change=self._changed,
                shard=(index, count),
                sleep=self._sleep,
            )
            self._shards.append(shard)
            delay = (index // per_window) * IDENTIFY_SPACING_S
            self._tasks.append(asyncio.create_task(self._run_shard(shard, delay)))

    async def _url(self) -> str:
        return self._gateway_url

    async def _run_shard(self, shard: GatewayShard, delay: float) -> None:
        if delay:
            await self._sleep(delay)
        await shard.run()

    def _compute(self) -> tuple[str, str | None]:
        shards = self._shards
        if self.rest.stopped == "token_invalid" or any(
            s.error_code == "token_invalid" for s in shards
        ):
            return "failed", "token_invalid"
        if self.rest.stopped == "invalid_requests":
            return "paused", "invalid_requests"
        failed = next((s for s in shards if s.status == "failed"), None)
        if failed is not None:
            return "failed", failed.error_code
        if self.rest.rate_limited:
            return "rate_limited", None
        if shards and all(s.status == "ready" for s in shards):
            missing = any(s.intents_missing for s in shards)
            return "ready", "intents_missing" if missing else None
        unavailable = self._unreachable or any(
            s.error_code == "discord_unavailable" for s in shards
        )
        return "connecting", "discord_unavailable" if unavailable else None

    def _changed(self) -> None:
        current = self._compute()
        if current == self._current:
            return
        self._current = current
        self._since = self._now()
        if current == ("failed", "token_invalid"):
            # A token reset in the portal: the gateway session must not go on with it either.
            for shard in self._shards:
                self._tasks.append(asyncio.create_task(shard.stop()))
        try:
            self._on_status(self)
        except Exception:
            log.exception("status listener failed")

    async def request_members(self, guild_id: str) -> bool:
        """Op 8 on the shard that holds the guild (Discord: `(guild_id >> 22) % shards`)."""
        if not self._shards:
            return False
        shard = self._shards[(int(guild_id) >> 22) % len(self._shards)]
        return await shard.request_members(guild_id)

    async def stop(self) -> None:
        self._on_stop()
        for shard in self._shards:
            await shard.stop()
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.rest.close()
        await self._http.aclose()
