"""Notify's DMs (D12, E4 of the step 6 plan; contracts/bot.md, Direct messages): the platform
decides who is told what; the bot only delivers `notify.dm.requested` as a Discord DM.

Only the container that holds the event's client sends, through the client's queue for the event,
so a burst of one event waits in its own queue. Each event's DMs go one after another in the
order Notify asked (opening the person's DM channel, then the message), so "it's here" never
overtakes "called in". A DM is not kept for later: with the client not ready the request is
dropped (Notify asks only while it is, and the notification stays in its inbox), and a full queue
drops it for that event alone. The queue lives in memory: a container that stops loses what it
had not sent, as Discord would have for a client that went away."""

from __future__ import annotations

import asyncio
import logging
import re
from collections import deque
from typing import Any

from canccu_kit import Event
from canccu_kit.access import TenantContext

from .deps import Deps
from .guard import guarded, is_event_url, strip_foreign_links

log = logging.getLogger("canccu_bot.dms")

CAP = 500
"""The rest client's own cap for one event's queue."""
SNOWFLAKE = re.compile(r"^[0-9]{17,20}$")


def message(
    ctx: TenantContext, data: dict[str, Any], color: int | None, page: Any
) -> dict[str, Any]:
    """The DM; `page(path)` is the event's page URL, or None without a hostname."""
    hosts = [] if ctx["primary_hostname"] is None else [ctx["primary_hostname"]]
    embed: dict[str, Any] = {
        "title": strip_foreign_links(str(data.get("title") or ""), hosts)[:256],
        "description": strip_foreign_links(str(data.get("body") or ""), hosts)[:4096],
    }
    if color is not None:
        embed["color"] = color
    url = str(data.get("url") or "")
    link = page(url) if url.startswith("/") else (url if is_event_url(url, hosts) else None)
    body: dict[str, Any] = {"content": "", "embeds": [embed], "components": []}
    if link is not None:
        button = {"type": 2, "style": 5, "label": "Open", "url": link}
        body["components"] = [{"type": 1, "components": [button]}]
    return guarded(body)


class Dms:
    def __init__(self, d: Deps, cap: int = CAP) -> None:
        self._d = d
        self._cap = cap
        self._queues: dict[str, deque[tuple[str, str, dict[str, Any]]]] = {}
        """Per event: (application, Discord user, the DM's body), the one being sent first."""
        self._tasks: dict[str, asyncio.Task[None]] = {}

    async def on_notify(self, event: Event) -> None:
        """Notify's events, on the event's stream, inside its tenant."""
        if event.type != "notify.dm.requested" or event.tenant is None:
            return
        user = str(event.data.get("discord_user_id") or "")
        ctx = await self._d.tenants.by_id(event.tenant)
        if not SNOWFLAKE.match(user) or ctx is None or ctx["status"] == "archived":
            return
        tenant = event.tenant
        async with self._d.db.tenant(tenant) as conn:
            app_id = await conn.fetchval("SELECT application_id FROM bot_bindings")
        client = None if app_id is None else self._d.held(app_id)
        if client is None:
            return  # another container holds the event's client and sends it
        if client.status["status"] != "ready":
            log.info("a DM of %s dropped: the client is %s", tenant, client.status["status"])
            return
        look = None if self._d.look is None else await self._d.look.of(ctx)
        host = ctx["primary_hostname"]

        def page(path: str) -> str | None:
            return None if host is None else self._d.hosts.event_url(host, path)

        body = message(ctx, event.data, look and look.color, page)
        # No await from here to the task check: _drain may not pop the queue in between.
        queue = self._queues.setdefault(tenant, deque())
        if len(queue) >= self._cap:
            log.warning("a DM of %s dropped: its queue is full", tenant)
            return
        queue.append((app_id, user, body))
        if tenant not in self._tasks:
            self._tasks[tenant] = asyncio.create_task(self._drain(tenant, queue))

    async def _drain(self, tenant: str, queue: deque[tuple[str, str, dict[str, Any]]]) -> None:
        try:
            while queue:
                app_id, user, body = queue[0]
                try:
                    await self._send(tenant, app_id, user, body)
                except Exception:
                    log.warning("a DM of %s was not delivered", tenant, exc_info=True)
                queue.popleft()
        finally:
            self._tasks.pop(tenant, None)
            if not queue and self._queues.get(tenant) is queue:
                self._queues.pop(tenant, None)

    async def _send(self, tenant: str, app_id: str, user: str, body: dict[str, Any]) -> None:
        client = self._d.held(app_id)
        if client is None:
            return  # the client moved to another container meanwhile
        rest = client.rest
        opened = await rest.request(
            "POST", "/users/@me/channels", tenant=tenant, json={"recipient_id": user}
        )
        path = f"/channels/{opened['id']}/messages"
        await rest.request("POST", path, tenant=tenant, json=body)

    async def settle(self) -> None:
        """Until every queue is empty: what the tests wait for."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks.values()), return_exceptions=True)

    async def close(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._tasks.clear()
        self._queues.clear()
