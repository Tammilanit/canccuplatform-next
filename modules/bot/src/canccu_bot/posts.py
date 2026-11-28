"""The announcement post (L3 to L5 of the step 6 plan; mockup 08; contracts/bot.md, Posts): one
message per announcement sent with the Discord channel, in the guild's `announcements` channel,
edited on `moments.announcement.changed` and marked withdrawn on `.withdrawn`. It says "From the
crew", never who (L5). It carries the crew's words, so it goes through the guard: it pings nobody
but, for an urgent one, the role the event picked (`announce_role`, none by default; never
@everyone, whose id is the guild's), and keeps no link off the event's hosts.

Every container reads every event: the post's row is claimed first, so exactly one posts. A post
Discord refuses for good (the channel gone, no access) is dropped and logged; one that failed
for a while is released and raised, so the bus runs it again."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx
from canccu_kit import Event
from canccu_kit.access import TenantContext

from . import store
from .clock import hhmm
from .deps import Deps
from .discord_api import DiscordRefused
from .guard import guarded, strip_foreign_links

log = logging.getLogger("canccu_bot.posts")

KIND = "announcement"
SNOWFLAKE = re.compile(r"^[0-9]{17,20}$")
FROM_CREW = "From the crew"


class PostFailed(Exception):
    """Discord did not take the post now; the bus runs the event again."""


def _hosts(ctx: TenantContext) -> list[str]:
    host = ctx["primary_hostname"]
    return [] if host is None else [host]


def body(
    ctx: TenantContext, title: str, text: str, footer: str, color: int | None, role: str | None
) -> dict[str, Any]:
    hosts = _hosts(ctx)
    embed: dict[str, Any] = {
        "title": strip_foreign_links(title, hosts)[:256],
        "description": strip_foreign_links(text, hosts),
        "footer": {"text": footer},
    }
    if color is not None:
        embed["color"] = color
    content = "" if role is None else f"<@&{role}>"
    return guarded({"content": content, "embeds": [embed]}, role=role)


async def _role(d: Deps, guild_id: str, urgent: bool) -> str | None:
    if not urgent or d.settings is None:
        return None
    await d.settings.ensure()
    role = str(d.settings.get("announce_role") or "").strip()
    if not SNOWFLAKE.match(role) or role == guild_id:
        return None
    return role


async def _color(d: Deps, ctx: TenantContext) -> int | None:
    look = None if d.look is None else await d.look.of(ctx)
    return None if look is None else look.color


async def _send(d: Deps, token: str, method: str, path: str, json: Any) -> httpx.Response:
    """Discord's answer; PostFailed when it may take it later."""
    try:
        response = await d.discord.as_bot(token, method, path, json)
    except DiscordRefused as refused:
        raise PostFailed(refused.code) from refused
    if response.status_code == 429 or response.status_code >= 500:
        raise PostFailed(str(response.status_code))
    return response


async def sent(d: Deps, ctx: TenantContext, data: dict[str, Any]) -> None:
    if not (data.get("channels") or {}).get("discord"):
        return
    tenant, key = ctx["tenant_id"], str(data.get("id") or "")
    async with d.db.tenant(tenant) as conn:
        bound = await conn.fetchrow("SELECT guild_id, application_id FROM bot_bindings")
        channel = await conn.fetchval(
            "SELECT target_id FROM bot_purposes WHERE purpose = 'announcements'"
        )
        if bound is None or channel is None or not key:
            return  # a purpose that is missing posts nowhere
        claimed = await conn.fetchval(
            "INSERT INTO bot_posts (kind, key, channel_id, title, updated_at)"
            " VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING key",
            KIND,
            key,
            channel,
            str(data.get("title") or ""),
            d.now(),
        )
        token = await store.bot_token(d.shared, d.secrets, conn, tenant, bound["application_id"])
    if claimed is None or token is None:
        return
    expires = hhmm(data.get("expires_at"), ctx["time_zone"])
    on_screens = (data.get("channels") or {}).get("screen") and expires
    footer = f"{FROM_CREW} · on the screens until {expires}" if on_screens else FROM_CREW
    role = await _role(d, bound["guild_id"], data.get("level") == "urgent")
    title, text = str(data.get("title") or ""), str(data.get("body") or "")
    post = body(ctx, title, text, footer, await _color(d, ctx), role)
    try:
        response = await _send(d, token, "POST", f"/channels/{channel}/messages", post)
    except PostFailed:
        await _release(d, tenant, key)
        raise
    if response.status_code >= 300:  # the channel is gone, or the bot may not post there
        log.warning("posting announcement %s failed: %s", key, response.status_code)
        await _release(d, tenant, key)
        return
    async with d.db.tenant(tenant) as conn:
        await conn.execute(
            "UPDATE bot_posts SET message_id = $1 WHERE kind = $2 AND key = $3",
            str(response.json()["id"]),
            KIND,
            key,
        )


async def _release(d: Deps, tenant: str, key: str) -> None:
    async with d.db.tenant(tenant) as conn:
        await conn.execute("DELETE FROM bot_posts WHERE kind = $1 AND key = $2", KIND, key)


async def _edit(d: Deps, ctx: TenantContext, key: str, post: Any, title: str | None) -> None:
    tenant = ctx["tenant_id"]
    async with d.db.tenant(tenant) as conn:
        row = await conn.fetchrow(
            "SELECT channel_id, message_id FROM bot_posts WHERE kind = $1 AND key = $2",
            KIND,
            key,
        )
        app_id = await conn.fetchval("SELECT application_id FROM bot_bindings")
        if row is None or row["message_id"] is None or app_id is None:
            return  # never posted, or still on its way: the poster's container edits after it
        token = await store.bot_token(d.shared, d.secrets, conn, tenant, app_id)
        if title is not None:
            await conn.execute(
                "UPDATE bot_posts SET title = $1, updated_at = $2 WHERE kind = $3 AND key = $4",
                title,
                d.now(),
                KIND,
                key,
            )
    if token is None:
        return
    path = f"/channels/{row['channel_id']}/messages/{row['message_id']}"
    response = await _send(d, token, "PATCH", path, post)
    if response.status_code >= 300:
        log.warning("editing the post of announcement %s failed: %s", key, response.status_code)


async def changed(d: Deps, ctx: TenantContext, data: dict[str, Any], at: str) -> None:
    title = str(data.get("title") or "")
    footer = f"Updated {hhmm(at, ctx['time_zone'])} · from the crew"
    post = body(ctx, title, str(data.get("body") or ""), footer, await _color(d, ctx), None)
    await _edit(d, ctx, str(data.get("id") or ""), post, title)


async def withdrawn(d: Deps, ctx: TenantContext, data: dict[str, Any], at: str) -> None:
    key = str(data.get("id") or "")
    async with d.db.tenant(ctx["tenant_id"]) as conn:
        title = await conn.fetchval(
            "SELECT title FROM bot_posts WHERE kind = $1 AND key = $2", KIND, key
        )
    if title is None:
        return
    said = f"This announcement was withdrawn at {hhmm(at, ctx['time_zone'])}."
    why = str(data.get("why") or "")
    if data.get("reason") != "withdrawn" and why:
        said = f"{said} {why}"
    post = body(ctx, f"Withdrawn: {title}", said, FROM_CREW, await _color(d, ctx), None)
    await _edit(d, ctx, key, post, None)


async def on_moments(d: Deps, event: Event) -> None:
    """Moments' announcement events, on the event's stream, inside its tenant."""
    if event.tenant is None or not event.type.startswith("moments.announcement."):
        return
    ctx = await d.tenants.by_id(event.tenant)
    if ctx is None or ctx["status"] == "archived":
        return
    if event.type == "moments.announcement.sent":
        await sent(d, ctx, event.data)
    elif event.type == "moments.announcement.changed":
        await changed(d, ctx, event.data, event.time)
    elif event.type == "moments.announcement.withdrawn":
        await withdrawn(d, ctx, event.data, event.time)
