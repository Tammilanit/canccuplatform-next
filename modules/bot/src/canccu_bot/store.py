"""The bot's reads from Postgres: an event's connection and binding, and what the pool and the
status events read before any tenant is set, through the global route tables."""

from __future__ import annotations

import logging
from typing import Any

from canccu_kit import SecretBox, SecretUndecryptable

from .db import Db

log = logging.getLogger("canccu_bot.store")


def token_aad(tenant_id: str, application_id: str) -> str:
    return f"bot:token:{tenant_id}:{application_id}"


async def connection(conn: Any) -> Any:
    """The current tenant's connection row, or None (the shared bot)."""
    return await conn.fetchrow(
        "SELECT mode, application_id, bot_token IS NOT NULL AS bot_token_set,"
        " client_secret IS NOT NULL AS client_secret_set, updated_at, updated_by, revision"
        " FROM bot_connections"
    )


async def binding(conn: Any) -> Any:
    return await conn.fetchrow(
        "SELECT guild_id, guild_name, application_id, bound_by, bound_at, commands_status,"
        " commands_flags_version, commands_registered_at, commands_error_code FROM bot_bindings"
    )


async def own_application_ids(db: Db) -> list[str]:
    async with db.platform() as conn:
        rows = await conn.fetch("SELECT application_id FROM bot_application_routes ORDER BY 1")
    return [r["application_id"] for r in rows]


async def own_applications(db: Db, box: SecretBox) -> dict[str, str]:
    """Each own application's bot token, opened for the pool. A token that does not open (sealed
    for another row, or under a retired key that is gone) is left closed and logged."""
    async with db.platform() as conn:
        routes = await conn.fetch("SELECT application_id, tenant_id FROM bot_application_routes")
    tokens: dict[str, str] = {}
    for route in routes:
        tenant, app_id = route["tenant_id"], route["application_id"]
        async with db.tenant(tenant) as conn:
            sealed = await conn.fetchval(
                "SELECT bot_token FROM bot_connections WHERE mode = 'own' AND application_id = $1",
                app_id,
            )
        if sealed is None:
            continue
        try:
            tokens[app_id] = box.open_text(sealed, token_aad(tenant, app_id))
        except SecretUndecryptable:
            log.error(
                "the bot token of application %s does not open; its client stays closed", app_id
            )
    return tokens


async def tenants_served(db: Db, application_id: str) -> list[str]:
    """The events a client serves: an own application's event, bound or not, and every event whose
    guild the application serves (for the shared one, every event with a guild on it)."""
    async with db.platform() as conn:
        rows = await conn.fetch(
            "SELECT tenant_id FROM bot_application_routes WHERE application_id = $1"
            " UNION SELECT tenant_id FROM bot_guild_routes WHERE application_id = $1",
            application_id,
        )
    return [r["tenant_id"] for r in rows]
