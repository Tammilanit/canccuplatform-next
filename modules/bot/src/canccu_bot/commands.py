"""The guild's slash commands (contracts/bot.md, Slash commands per guild): exactly the commands
whose flags are on for the event, written per guild in one bulk overwrite, and none for an
archived event. The commands themselves and the framework that answers them come with link 3;
until then the set is empty, so a bound guild shows no command of this platform."""

from __future__ import annotations

import logging
from typing import Any

from canccu_kit.access import TenantContext

from . import store
from .deps import Deps
from .discord_api import DiscordRefused

log = logging.getLogger("canccu_bot.commands")

CATALOGUE: list[tuple[str, dict[str, Any]]] = []
"""(feature flag, the command as Discord takes it)."""


def wanted(ctx: TenantContext) -> list[dict[str, Any]]:
    if ctx["status"] == "archived":
        return []
    return [command for flag, command in CATALOGUE if ctx["flags"].get(flag, False)]


def _error_code(status: int) -> str:
    if status == 429:
        return "rate_limited"
    if status in (401, 403):
        return "missing_access"  # the scope `applications.commands` or the bot is gone
    return "discord_unavailable"


async def register(d: Deps, ctx: TenantContext) -> None:
    """Write the event's set to its guild and record the outcome on the binding. A failure stays
    on this guild's binding (`failed` with its code) and never stops another guild's."""
    tenant = ctx["tenant_id"]
    async with d.db.tenant(tenant) as conn:
        bound = await store.binding(conn)
        if bound is None:
            return
        token = await store.bot_token(d.shared, d.secrets, conn, tenant, bound["application_id"])
    commands = wanted(ctx)
    path = f"/applications/{bound['application_id']}/guilds/{bound['guild_id']}/commands"
    error: str | None = None
    if token is None:
        error = "token_invalid"
    else:
        try:
            response = await d.discord.as_bot(token, "PUT", path, commands)
            if response.status_code >= 300:
                error = _error_code(response.status_code)
        except DiscordRefused as refused:
            error = refused.code
    status = "failed" if error else ("removed" if ctx["status"] == "archived" else "registered")
    if error:
        log.warning("registering the commands of guild %s failed: %s", bound["guild_id"], error)
    async with d.db.tenant(tenant) as conn:
        await conn.execute(
            "UPDATE bot_bindings SET commands_status = $1, commands_error_code = $2,"
            " commands_flags_version = CASE WHEN $2::text IS NULL THEN $3"
            "   ELSE commands_flags_version END,"
            " commands_registered_at = CASE WHEN $2::text IS NULL THEN $4"
            "   ELSE commands_registered_at END"
            " WHERE guild_id = $5",
            status,
            error,
            ctx["flags_version"],
            d.now(),
            bound["guild_id"],
        )
