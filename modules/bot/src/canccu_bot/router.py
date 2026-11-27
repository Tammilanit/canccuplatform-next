"""Routing a client's gateway events by guild (contracts/bot.md, The client pool, Routing; and
Privileged intents and data per event).

A guild's event is its guild route, and only when the route names the application this client
runs. Everything else is dropped before any handler sees it: a guild bound to no event or to
another application, an archived event, and a feed whose flag is off for the event. The shared
bot leaves a guild no event chose for it after 15 minutes; an own bot stays there and drops its
data. A guild that removes the bot ends its binding (`bot_removed`); one that is only unavailable
in an outage stays bound."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from canccu_kit import tenant_scope
from canccu_kit.access import TenantContext

from .deps import Deps
from .guild import unbind

log = logging.getLogger("canccu_bot.router")

GUILDS, MEMBERS, VOICE, PRESENCES, MESSAGES = 1 << 0, 1 << 1, 1 << 7, 1 << 8, 1 << 9
INTENTS = GUILDS | MEMBERS | VOICE | PRESENCES | MESSAGES
"""Presence and members are privileged; guild messages is not; message content never is asked
for (D5): nothing the platform does reads message text."""

FEEDS = {
    "PRESENCE_UPDATE": "bot.presence",
    "GUILD_MEMBER_ADD": "bot.members",
    "GUILD_MEMBER_UPDATE": "bot.members",
    "GUILD_MEMBER_REMOVE": "bot.members",
    "GUILD_MEMBERS_CHUNK": "bot.members",
    "VOICE_STATE_UPDATE": "bot.voice",
    "MESSAGE_CREATE": "bot.messages",
}
"""Each feed of gateway data and the flag it belongs to."""

LEAVE_AFTER_S = 15 * 60
FRESH_S = 10.0
"""How long a route or an event's flags are read from memory; the pool's tick is as long."""

NOT_CONNECTED = "This server is not connected to an event on this platform."
OUTSIDE = "Use the bot's commands in your event's Discord server."
ENDED = "This event has ended; the bot does nothing more here."
EPHEMERAL = 64

Handler = Callable[[str, dict[str, Any]], Awaitable[None]]
"""(gateway event, its data), run inside the event's tenant."""


class Directory:
    """Guild routes and events' contexts as every router of the container reads them, kept for
    `FRESH_S`, so a presence storm does not ask Postgres or the tenants module per message."""

    def __init__(self, d: Deps, clock: Callable[[], float] = time.monotonic) -> None:
        self._d = d
        self._clock = clock
        self._routes: dict[str, tuple[str, str]] = {}
        self._routes_at = -FRESH_S
        self._contexts: dict[str, tuple[float, TenantContext | None]] = {}

    async def route(self, guild_id: str, *, fresh: bool = False) -> tuple[str, str] | None:
        """(tenant, application) of a bound guild."""
        if fresh:
            async with self._d.db.platform() as conn:
                row = await conn.fetchrow(
                    "SELECT tenant_id, application_id FROM bot_guild_routes WHERE guild_id = $1",
                    guild_id,
                )
            return None if row is None else (row["tenant_id"], row["application_id"])
        if self._clock() - self._routes_at >= FRESH_S:
            async with self._d.db.platform() as conn:
                rows = await conn.fetch(
                    "SELECT guild_id, tenant_id, application_id FROM bot_guild_routes"
                )
            self._routes = {r["guild_id"]: (r["tenant_id"], r["application_id"]) for r in rows}
            self._routes_at = self._clock()
        return self._routes.get(guild_id)

    async def own_event(self, application_id: str) -> str | None:
        async with self._d.db.platform() as conn:
            found = await conn.fetchval(
                "SELECT tenant_id FROM bot_application_routes WHERE application_id = $1",
                application_id,
            )
        return None if found is None else str(found)

    async def context(self, tenant: str) -> TenantContext | None:
        hit = self._contexts.get(tenant)
        if hit is not None and self._clock() - hit[0] < FRESH_S:
            return hit[1]
        ctx: TenantContext | None = await self._d.tenants.by_id(tenant)
        self._contexts[tenant] = (self._clock(), ctx)
        return ctx

    def forget(self, tenant: str | None = None) -> None:
        """A tenants event changed an event's status or flags, or a binding changed here."""
        if tenant is None:
            self._contexts.clear()
        else:
            self._contexts.pop(tenant, None)
        self._routes_at = -FRESH_S


class Router:
    def __init__(
        self,
        d: Deps,
        application_id: str,
        directory: Directory,
        *,
        handlers: dict[str, Handler] | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._d = d
        self.application_id = application_id
        self._directory = directory
        self._handlers = handlers or {}
        """By feed flag, and `interaction` for a command's handler (step 6, link 3)."""
        self._sleep = sleep
        self.rest: Any = None
        """The client's RestClient, set once the client exists."""
        self._leaving: dict[str, asyncio.Task[None]] = {}

    @property
    def shared(self) -> bool:
        return self._d.shared is not None and self.application_id == self._d.shared.application_id

    async def dispatch(self, event: str, data: dict[str, Any]) -> None:
        if event == "GUILD_CREATE":
            await self._guild_seen(str(data.get("id")))
        elif event == "GUILD_DELETE":
            await self._guild_gone(str(data.get("id")), data.get("unavailable") is True)
        elif event == "INTERACTION_CREATE":
            await self._interaction(data)
        elif event in FEEDS:
            await self._feed(event, data)

    async def _ours(self, guild_id: str, *, fresh: bool = False) -> str | None:
        """The event of a guild bound for this application."""
        route = await self._directory.route(guild_id, fresh=fresh)
        return route[0] if route is not None and route[1] == self.application_id else None

    async def _live(self, tenant: str) -> TenantContext | None:
        ctx = await self._directory.context(tenant)
        return None if ctx is None or ctx["status"] == "archived" else ctx

    async def _guild_seen(self, guild_id: str) -> None:
        if await self._ours(guild_id, fresh=True) is not None:
            self._stay(guild_id)
        elif self.shared and guild_id not in self._leaving:
            task = asyncio.create_task(self._leave_later(guild_id))
            self._leaving[guild_id] = task

    def _stay(self, guild_id: str) -> None:
        task = self._leaving.pop(guild_id, None)
        if task is not None:
            task.cancel()

    async def _leave_later(self, guild_id: str) -> None:
        """A plain invite link, a bind that failed, a guild bound to another event's own bot:
        the shared bot keeps no data of a guild no event chose for it."""
        await self._sleep(LEAVE_AFTER_S)
        self._leaving.pop(guild_id, None)
        if await self._ours(guild_id, fresh=True) is not None:
            return
        try:
            await self.rest.request("DELETE", f"/users/@me/guilds/{guild_id}")
        except Exception:
            log.warning("leaving unbound guild %s failed", guild_id, exc_info=True)

    async def _guild_gone(self, guild_id: str, unavailable: bool) -> None:
        if unavailable:  # a Discord outage: the binding stays
            return
        self._stay(guild_id)
        tenant = await self._ours(guild_id, fresh=True)
        if tenant is not None:
            await unbind(self._d, tenant, "bot_removed", None)
            self._directory.forget()

    async def _answer(self, data: dict[str, Any], text: str) -> None:
        path = f"/interactions/{data.get('id')}/{data.get('token')}/callback"
        body = {"type": 4, "data": {"content": text, "flags": EPHEMERAL}}
        try:
            await self.rest.request("POST", path, json=body)
        except Exception:
            log.warning("answering interaction %s failed", data.get("id"), exc_info=True)

    async def _interaction(self, data: dict[str, Any]) -> None:
        guild_id = data.get("guild_id")
        if guild_id is None:
            # A direct message: an own application's belongs to its event; the shared bot
            # cannot tell which event a person means.
            tenant = None if self.shared else await self._directory.own_event(self.application_id)
            if tenant is None:
                await self._answer(data, OUTSIDE)
                return
        else:
            tenant = await self._ours(str(guild_id))
            if tenant is None:
                await self._answer(data, NOT_CONNECTED)
                return
        if await self._live(tenant) is None:
            await self._answer(data, ENDED)
            return
        await self._run("interaction", tenant, "INTERACTION_CREATE", data)

    async def _feed(self, event: str, data: dict[str, Any]) -> None:
        guild_id = data.get("guild_id")
        if guild_id is None:
            return  # a direct message's text is no feed of any event
        tenant = await self._ours(str(guild_id))
        if tenant is None:
            return
        ctx = await self._live(tenant)
        flag = FEEDS[event]
        # A flag the context does not carry is off: no data of a feed nobody switched on.
        if ctx is None or not ctx["flags"].get(flag, False):
            return
        await self._run(flag, tenant, event, data)

    async def _run(self, key: str, tenant: str, event: str, data: dict[str, Any]) -> None:
        handler = self._handlers.get(key)
        if handler is None:
            return
        try:
            with tenant_scope(tenant):
                await handler(event, data)
        except Exception:
            # One event's bad data or a handler's bug never stops another guild's handling.
            log.exception("handling %s for %s failed", event, tenant)

    def close(self) -> None:
        for task in self._leaving.values():
            task.cancel()
        self._leaving.clear()
