"""The guild's slash commands (contracts/bot.md, Slash commands per guild): exactly the commands
whose flags are on for the event, written per guild in one bulk overwrite, and none for an
archived event. A set is written only when its hash differs from the one last written to that
guild (O4 of the step 6 plan), so a deploy or a flag change that leaves a guild's set as it was
costs nothing of Discord's daily limit on command writes. The framework (interactions.py) answers
them; #122 adds the event's own commands here, the Finals track `/finals`."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from canccu_kit.access import TenantContext

from . import store
from .announce import ANNOUNCE
from .deps import Deps
from .discord_api import DiscordRefused
from .doors import FOOD, HUB, NOW, PRIVACY
from .framework import Command
from .photos import REMOVE, SEND
from .ticker import TICKER_COMMAND

log = logging.getLogger("canccu_bot.commands")

COMMANDS: tuple[Command, ...] = (
    FOOD,
    NOW,
    HUB,
    PRIVACY,
    ANNOUNCE,
    TICKER_COMMAND,
    SEND,
    REMOVE,
)
"""The platform's commands, each under its feature flag or always on (contracts/bot.md,
Commands); the Finals track adds `/finals`."""


def wanted(d: Deps, ctx: TenantContext) -> list[dict[str, Any]]:
    if ctx["status"] == "archived":
        return []
    return [c.payload() for c in d.commands if c.flag is None or ctx["flags"].get(c.flag, False)]


def digest(commands: list[dict[str, Any]]) -> str:
    return hashlib.sha256(json.dumps(commands, sort_keys=True).encode()).hexdigest()


def _error_code(status: int) -> str:
    if status == 429:
        return "rate_limited"
    if status in (401, 403):
        return "missing_access"  # the scope `applications.commands` or the bot is gone
    return "discord_unavailable"


async def register(d: Deps, ctx: TenantContext, *, force: bool = False) -> None:
    """Write the event's set to its guild and record the outcome on the binding. A failure stays
    on this guild's binding (`failed` with its code) and never stops another guild's."""
    tenant = ctx["tenant_id"]
    async with d.db.tenant(tenant) as conn:
        bound = await conn.fetchrow(
            "SELECT guild_id, application_id, commands_status, commands_hash FROM bot_bindings"
        )
        if bound is None:
            return
        token = await store.bot_token(d.shared, d.secrets, conn, tenant, bound["application_id"])
    commands = wanted(d, ctx)
    written = digest(commands)
    path = f"/applications/{bound['application_id']}/guilds/{bound['guild_id']}/commands"
    error: str | None = None
    # `force`: the admin's sync, for a guild whose commands someone removed by hand.
    unchanged = (
        not force and bound["commands_hash"] == written and bound["commands_status"] != "failed"
    )
    if token is None:
        error = "token_invalid"
    elif not unchanged:
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
        # A failed write forgets the hash, so the next one writes again whatever the set.
        await conn.execute(
            "UPDATE bot_bindings SET commands_status = $1, commands_error_code = $2,"
            " commands_flags_version = CASE WHEN $2::text IS NULL THEN $3"
            "   ELSE commands_flags_version END,"
            " commands_registered_at = CASE WHEN $2::text IS NULL AND NOT $6 THEN $4"
            "   ELSE commands_registered_at END,"
            " commands_hash = CASE WHEN $2::text IS NULL THEN $7 END"
            " WHERE guild_id = $5",
            status,
            error,
            ctx["flags_version"],
            d.now(),
            bound["guild_id"],
            unchanged,
            written,
        )


async def register_all(d: Deps) -> None:
    """Every bound guild's set, at start: a version that changes the commands reaches the guilds
    bound before it. The hash keeps an unchanged set from being written again, so a restart or a
    second container costs nothing of Discord's daily limit."""
    async with d.db.platform() as conn:
        rows = await conn.fetch("SELECT DISTINCT tenant_id FROM bot_guild_routes")
    for row in rows:
        try:
            ctx = await d.tenants.by_id(row["tenant_id"])
            if ctx is not None:
                await register(d, ctx)
        except Exception:
            log.exception("registering the commands of event %s failed", row["tenant_id"])
