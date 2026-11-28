"""One gateway session of one client (a shard): identify or resume, heartbeats, dispatches, and
reconnecting by itself with a growing back-off (contracts/bot.md, One event's trouble stays its
own). Ported from what the legacy bot left to discord.py, kept to what the contract needs."""

from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import Awaitable, Callable
from typing import Any, Literal, Protocol

log = logging.getLogger("canccu_bot.gateway")

MEMBERS_INTENT, PRESENCES_INTENT = 1 << 1, 1 << 8
PRIVILEGED = MEMBERS_INTENT | PRESENCES_INTENT | (1 << 15)
"""Members, presences and message content: Discord refuses them unless the application enabled
them in its developer portal."""

FATAL = {4010, 4011, 4012, 4013}
"""Invalid shard, sharding required, invalid API version, invalid intents: retrying cannot help."""
NEW_SESSION = {4007, 4009}
"""Invalid sequence, session timed out: the next connection identifies anew."""
ZOMBIE = 4000
"""Our close of a connection whose heartbeats go unanswered; a code other than 1000 or 1001 keeps
the session resumable."""

ShardStatus = Literal["connecting", "ready", "failed"]


class GatewayClosed(Exception):
    def __init__(self, code: int | None) -> None:
        super().__init__(f"gateway closed {code}")
        self.code = code


class Transport(Protocol):
    async def send(self, payload: dict[str, Any]) -> None: ...

    async def recv(self) -> dict[str, Any]:
        """The next payload; raises GatewayClosed when the connection ends."""
        ...

    async def close(self, code: int = 1000) -> None: ...


Connector = Callable[[str], Awaitable[Transport]]
Dispatch = Callable[[str, dict[str, Any]], Awaitable[None]]


def backoff(failures: int) -> float:
    """Seconds to wait after `failures` failed attempts in a row: 1, 2, 4 … at most 5 minutes."""
    return float(min(300, 2 ** min(failures, 9)))


class GatewayShard:
    def __init__(
        self,
        token: str,
        intents: int,
        *,
        connector: Connector,
        gateway_url: Callable[[], Awaitable[str]],
        on_dispatch: Dispatch,
        on_change: Callable[[], None] = lambda: None,
        shard: tuple[int, int] = (0, 1),
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._token = token
        self.intents = intents
        self._connector = connector
        self._gateway_url = gateway_url
        self._on_dispatch = on_dispatch
        self.on_change = on_change
        self._shard = shard
        self._sleep = sleep
        self.status: ShardStatus = "connecting"
        self.error_code: str | None = None
        self.bot_user: dict[str, str] | None = None
        self.session_id: str | None = None
        self._resume_url: str | None = None
        self._seq: int | None = None
        self._ws: Transport | None = None
        self._stopped = False
        self._reached = False
        self.intents_missing = False

    def _set(self, status: ShardStatus, error_code: str | None) -> None:
        if (status, error_code) != (self.status, self.error_code):
            self.status, self.error_code = status, error_code
            self.on_change()

    async def run(self) -> None:
        """Connect and keep connected until stopped or the token fails."""
        waits = 0  # since the last READY or RESUMED, so the back-off starts again at 1 s
        while not self._stopped:
            self._reached = False
            code: int | None = None
            try:
                await self._connection()
            except GatewayClosed as closed:
                code = closed.code
            except (OSError, TimeoutError) as exc:
                log.info("gateway connection failed: %s", exc)
            finally:
                self._ws = None
            if self._stopped or not self._after_close(code):
                return
            if self._reached:
                waits = 0
            # A refused intent is the application's setting, not Discord being away.
            away = not self._reached and code != 4014
            self._set("connecting", "discord_unavailable" if away else self.error_code_kept())
            await self._sleep(backoff(waits))
            waits += 1

    def error_code_kept(self) -> str | None:
        """intents_missing outlives a reconnect: the application still lacks them."""
        return "intents_missing" if self.intents_missing else None

    def _after_close(self, code: int | None) -> bool:
        """What a close means for the next attempt; False: stop for good."""
        if code == 4004:
            self._set("failed", "token_invalid")
            return False
        if code == 4014 and self.intents & PRIVILEGED:
            # The event's features that need them stay off until the admin enables them and the
            # client reconnects (contracts/bot.md, Missing intents).
            self.intents &= ~PRIVILEGED
            self.session_id = None
            self.intents_missing = True
            return True
        if code in FATAL or code == 4014:
            self._set("failed", "discord_unavailable")
            return False
        if code in NEW_SESSION:
            self.session_id = None
        return True

    async def _connection(self) -> None:
        """One connection, until it ends."""
        url = (
            self._resume_url if self.session_id and self._resume_url else await self._gateway_url()
        )
        ws = self._ws = await self._connector(f"{url}?v=10&encoding=json")
        hello = await ws.recv()
        interval = float(hello["d"]["heartbeat_interval"]) / 1000
        acked = asyncio.Event()
        acked.set()
        beat = asyncio.create_task(self._heartbeat(ws, interval, acked))
        try:
            await ws.send(self._hello_answer())
            while True:
                message = await ws.recv()
                op = message.get("op")
                if op == 0:
                    await self._dispatch(message)
                elif op == 1:
                    await ws.send({"op": 1, "d": self._seq})
                elif op in (7, 9):  # reconnect; invalid session, resumable or not
                    if op == 9 and not message.get("d"):
                        self.session_id = None
                    await ws.close(ZOMBIE)
                    return
                elif op == 11:
                    acked.set()
        finally:
            beat.cancel()

    def _hello_answer(self) -> dict[str, Any]:
        if self.session_id is not None:
            d = {"token": self._token, "session_id": self.session_id, "seq": self._seq}
            return {"op": 6, "d": d}
        properties = {"os": "linux", "browser": "canccu", "device": "canccu"}
        return {
            "op": 2,
            "d": {
                "token": self._token,
                "intents": self.intents,
                "properties": properties,
                "shard": list(self._shard),
            },
        }

    async def _heartbeat(self, ws: Transport, interval: float, acked: asyncio.Event) -> None:
        # Discord asks for the first beat after a random part of the interval.
        await asyncio.sleep(interval * random.random())
        while True:
            if not acked.is_set():
                log.info("heartbeat not acknowledged; reconnecting")
                await ws.close(ZOMBIE)
                return
            acked.clear()
            await ws.send({"op": 1, "d": self._seq})
            await asyncio.sleep(interval)

    async def _dispatch(self, message: dict[str, Any]) -> None:
        if message.get("s") is not None:
            self._seq = int(message["s"])
        event, data = str(message.get("t")), message.get("d") or {}
        ready = False
        if event == "READY":
            self.session_id = data.get("session_id")
            self._resume_url = data.get("resume_gateway_url")
            user = data.get("user") or {}
            self.bot_user = {"id": str(user.get("id")), "name": str(user.get("username"))}
            ready = True
        elif event == "RESUMED":
            ready = True
        if ready:
            self._reached = True
            self._set("ready", self.error_code_kept())
        try:
            await self._on_dispatch(event, data)
        except Exception:
            # One guild's bad data or a handler's bug never stops the client.
            log.exception("handler for %s failed", event)

    async def request_members(self, guild_id: str) -> bool:
        """Op 8 for every member of the guild, with their presences when the presence intent is
        on. False without the members intent (Discord refuses a full list without it) or before
        the session is ready."""
        if self._ws is None or self.status != "ready" or not self.intents & MEMBERS_INTENT:
            return False
        presences = bool(self.intents & PRESENCES_INTENT)
        d = {"guild_id": guild_id, "query": "", "limit": 0, "presences": presences}
        await self._ws.send({"op": 8, "d": d})
        return True

    async def stop(self) -> None:
        self._stopped = True
        if self._ws is not None:
            await self._ws.close(1000)
