"""The event's voice in Discord (L6, L8 of the step 6 plan): the bot's nickname in each server is
the event's name, and its embeds take the event's colour.

The name is the tenants module's public `GET /api/tenants/current` on the event's own hostname,
as theming reads it for the logo; the colour is `embed_color` of theming's current theme, through
its internal read, which ignores the info-page mode, so an event whose pages need a sign-in keeps
its colour in Discord too. Both are kept a minute per event and dropped when the event changes."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx
from canccu_kit import ServiceIdentity
from canccu_kit.access import TenantContext

from . import store
from .deps import Deps
from .discord_api import DiscordRefused

log = logging.getLogger("canccu_bot.look")

KEEP_S = 60.0
NICK_MAX = 32
"""Discord's longest nickname."""


@dataclass(frozen=True)
class Look:
    name: str | None
    """None: no name could be read (no hostname yet, or tenants did not answer)."""
    color: int | None


class EventLook:
    def __init__(
        self,
        tenants_url: str,
        theming_url: str,
        identity: ServiceIdentity,
        http: httpx.AsyncClient,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._tenants = tenants_url.rstrip("/")
        self._theming = theming_url.rstrip("/")
        self._identity = identity
        self._http = http
        self._clock = clock
        self._kept: dict[str, tuple[float, Look]] = {}

    async def of(self, ctx: TenantContext) -> Look:
        tenant = ctx["tenant_id"]
        hit = self._kept.get(tenant)
        if hit is not None and self._clock() - hit[0] < KEEP_S:
            return hit[1]
        look = Look(await self._name(ctx), await self._color(tenant))
        self._kept[tenant] = (self._clock(), look)
        return look

    def forget(self, tenant: str) -> None:
        self._kept.pop(tenant, None)

    async def _name(self, ctx: TenantContext) -> str | None:
        host = ctx["primary_hostname"]
        if host is None:
            return None
        try:
            response = await self._http.get(
                f"{self._tenants}/api/tenants/current", headers={"host": host}
            )
            name = response.json().get("name") if response.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            log.warning("reading the name of %s failed", ctx["tenant_id"], exc_info=True)
            return None
        return name if isinstance(name, str) and name.strip() else None

    async def _color(self, tenant: str) -> int | None:
        try:
            response = await self._http.get(
                f"{self._theming}/internal/theming/current",
                params={"tenant_id": tenant},
                headers=self._identity.headers("theming"),
            )
            color = response.json().get("embed_color") if response.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            log.warning("reading the colour of %s failed", tenant, exc_info=True)
            return None
        return color if isinstance(color, int) and 0 <= color <= 0xFFFFFF else None


async def set_nickname(d: Deps, ctx: TenantContext) -> None:
    """The bot's nickname in the event's server: the event's name, after a bind and when the name
    changes. A failure is logged and changes nothing else: the nickname only names the bot."""
    if d.look is None:
        return
    tenant = ctx["tenant_id"]
    async with d.db.tenant(tenant) as conn:
        bound = await store.binding(conn)
        if bound is None:
            return
        token = await store.bot_token(d.shared, d.secrets, conn, tenant, bound["application_id"])
    name = (await d.look.of(ctx)).name
    if token is None or name is None:
        return
    path = f"/guilds/{bound['guild_id']}/members/@me"
    try:
        response = await d.discord.as_bot(token, "PATCH", path, {"nick": name[:NICK_MAX]})
    except DiscordRefused:
        log.warning("setting the nickname in guild %s failed", bound["guild_id"])
        return
    if response.status_code >= 300:
        log.warning("setting the nickname in guild %s: %s", bound["guild_id"], response.status_code)
