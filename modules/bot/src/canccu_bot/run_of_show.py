"""The run-of-show posts (L7 of the step 6 plan; mockup 10 C; contracts/bot.md, Run-of-show
posts) and the agenda's events that keep the now-and-next board true.

A reminder posts at the item's shortest lead time (the "go now" nudge: the board already shows
what comes), an organiser's announcement with its message; both in the `announcements` channel,
only for a public item chosen for `discord_channel` and never for quiet hours. They go through
the event's own client and queue, so only the container holding it posts; with no client ready
nothing is posted and nothing kept (E1). Each source event posts once: its row is claimed first."""

from __future__ import annotations

import logging
from typing import Any

from canccu_kit import Event
from canccu_kit.access import TenantContext

from .clock import hhmm
from .deps import Deps
from .food import board_changed
from .guard import guarded, strip_foreign_links
from .rest import RestError

log = logging.getLogger("canccu_bot.run_of_show")

KIND = "run_of_show"
POSTED = ("agenda.reminder.triggered", "agenda.item.announced")
FROM_CREW = "From the crew"


class PostFailed(Exception):
    """Discord did not take the post now; the bus runs the event again."""


def _chosen(item: dict[str, Any]) -> bool:
    return (
        item.get("visibility") == "public"
        and item.get("kind") != "quiet_hours"
        and "discord_channel" in (item.get("notify_channels") or ())
    )


def _starts_in(minutes: int) -> str:
    if minutes <= 0:
        return "Starts now"
    if minutes < 60:
        return f"Starts in {minutes} minute{'' if minutes == 1 else 's'}"
    hours, rest = divmod(minutes, 60)
    return f"Starts in {hours} h {rest} min" if rest else f"Starts in {hours} h"


def post(ctx: TenantContext, event: Event, color: int | None) -> dict[str, Any]:
    hosts = [] if ctx["primary_hostname"] is None else [ctx["primary_hostname"]]
    item = event.data["item"]
    when = [hhmm(item.get("starts_at"), ctx["time_zone"]), str(item.get("location") or "")]
    lines = [" · ".join(w for w in when if w)]
    if event.type == "agenda.item.announced":
        heading = FROM_CREW
        if event.data.get("message"):
            lines.append(str(event.data["message"]))
    else:
        heading = _starts_in(int(event.data.get("lead_minutes") or 0))
    embed: dict[str, Any] = {
        "author": {"name": heading},
        "title": strip_foreign_links(str(item.get("title") or ""), hosts)[:256],
        "description": strip_foreign_links("\n".join(lines), hosts),
    }
    if color is not None:
        embed["color"] = color
    return guarded({"content": "", "embeds": [embed]})


def _wanted(event: Event) -> bool:
    item = event.data.get("item")
    if event.type not in POSTED or not isinstance(item, dict) or not _chosen(item):
        return False
    if event.type == "agenda.item.announced":
        return True
    leads = [int(n) for n in event.data.get("leads_minutes") or [] if isinstance(n, int)]
    return not leads or event.data.get("lead_minutes") == min(leads)


async def _post(d: Deps, ctx: TenantContext, event: Event) -> None:
    tenant = ctx["tenant_id"]
    async with d.db.tenant(tenant) as conn:
        app_id = await conn.fetchval("SELECT application_id FROM bot_bindings")
        channel = await conn.fetchval(
            "SELECT target_id FROM bot_purposes WHERE purpose = 'announcements'"
        )
    client = None if app_id is None else d.held(app_id)
    if channel is None or client is None or client.status["status"] != "ready":
        return  # no channel, another container's client, or a client that cannot send now
    async with d.db.tenant(tenant) as conn:
        claimed = await conn.fetchval(
            "INSERT INTO bot_posts (kind, key, channel_id, title, updated_at)"
            " VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING key",
            KIND,
            event.id,
            channel,
            str(event.data["item"].get("title") or ""),
            d.now(),
        )
    if claimed is None:
        return
    look = None if d.look is None else await d.look.of(ctx)
    body = post(ctx, event, None if look is None else look.color)
    try:
        sent = await client.rest.request(
            "POST", f"/channels/{channel}/messages", tenant=tenant, json=body
        )
    except RestError as exc:
        if exc.code == "discord_error" and exc.status < 500:
            log.warning("posting %s of %s failed for good: %s", event.type, tenant, exc.status)
            return  # the channel is gone or closed to the bot: dropped (E3)
        await _release(d, tenant, event.id)
        raise PostFailed(exc.code) from exc
    async with d.db.tenant(tenant) as conn:
        await conn.execute(
            "UPDATE bot_posts SET message_id = $1 WHERE kind = $2 AND key = $3",
            str(sent["id"]),
            KIND,
            event.id,
        )


async def _release(d: Deps, tenant: str, key: str) -> None:
    async with d.db.tenant(tenant) as conn:
        await conn.execute("DELETE FROM bot_posts WHERE kind = $1 AND key = $2", KIND, key)


async def on_agenda(d: Deps, event: Event) -> None:
    """The agenda's events, on the event's stream, inside its tenant."""
    if event.tenant is None:
        return
    ctx = await d.tenants.by_id(event.tenant)
    if ctx is None or ctx["status"] == "archived":
        return
    if event.type.startswith(("agenda.item.", "agenda.items.", "agenda.kind.")):
        async with d.db.tenant(event.tenant) as conn:
            await board_changed(conn)
    if _wanted(event):
        await _post(d, ctx, event)
