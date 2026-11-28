"""The event's guild as the setup and the check see it: its channels, its roles and the bot's own
roles, read live from Discord on each request (contracts/bot.md, Purposes). Nothing of it is kept:
a channel renamed or deleted in Discord shows as it is on the next read (E3).

These calls go outside the event's client queue, as the command writes do (commands.py): they are
an admin's few reads and writes on a page, and the container answering the page may not hold the
event's client."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from canccu_kit import KitError
from canccu_kit.access import TenantContext

from . import perms, store
from .access import archived
from .deps import Deps
from .discord_api import DiscordRefused


def unavailable() -> KitError:
    return KitError("Discord did not answer", status=503, code="discord_unavailable")


@dataclass
class Server:
    tenant: str
    guild_id: str
    application_id: str
    token: str
    bot_user_id: str
    channels: dict[str, dict[str, Any]]
    roles: dict[str, dict[str, Any]]
    held: list[str]
    """The roles the bot holds."""

    def base(self) -> int:
        return perms.base(self.guild_id, self.roles, self.held)

    def in_channel(self, channel_id: str) -> int:
        overwrites = self.channels[channel_id].get("permission_overwrites") or []
        return perms.in_channel(self.guild_id, self.roles, self.held, self.bot_user_id, overwrites)

    def top(self) -> int:
        return perms.top_position(self.roles, self.held)

    async def call(self, d: Deps, method: str, path: str, body: Any = None) -> Any:
        """A call as the event's bot; None when Discord refused it (a 4xx), 503 when it is down."""
        try:
            response = await d.discord.as_bot(self.token, method, path, body)
        except DiscordRefused as exc:
            raise unavailable() from exc
        if response.status_code >= 500:
            raise unavailable()
        if response.status_code >= 300:
            return None
        return response.json() if response.content else {}


def not_bound() -> KitError:
    return KitError("no guild is bound", status=404, code="not_found")


async def read(d: Deps, ctx: TenantContext) -> Server:
    """The bound guild now; 404 without a binding, 409 for an archived event (the bot reads
    nothing more for it), 503 when Discord does not answer."""
    if ctx["status"] == "archived":
        raise archived()
    tenant = ctx["tenant_id"]
    async with d.db.tenant(tenant) as conn:
        bound = await conn.fetchrow("SELECT guild_id, application_id FROM bot_bindings")
        if bound is None:
            raise not_bound()
        token = await store.bot_token(d.shared, d.secrets, conn, tenant, bound["application_id"])
    if token is None:
        raise unavailable()
    server = Server(tenant, bound["guild_id"], bound["application_id"], token, "", {}, {}, [])
    guild = f"/guilds/{server.guild_id}"
    me = await server.call(d, "GET", "/users/@me")
    channels = await server.call(d, "GET", f"{guild}/channels")
    roles = await server.call(d, "GET", f"{guild}/roles")
    if me is None or channels is None or roles is None:
        raise unavailable()  # the bot is out of the guild: its binding ends on GUILD_DELETE
    server.bot_user_id = str(me.get("id"))
    member = await server.call(d, "GET", f"{guild}/members/{server.bot_user_id}")
    server.channels = {str(c["id"]): c for c in channels}
    server.roles = {str(r["id"]): r for r in roles}
    server.held = [str(r) for r in (member or {}).get("roles", [])]
    return server
