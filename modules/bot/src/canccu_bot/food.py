"""One message per food order in the guild's `food` channel (L2, L9 of the step 6 plan; mockup 10
B; contracts/bot.md, Living messages): what each order shows is recorded here from the pizza
events, and the editor (living.py) posts and edits it.

Only counts and the holder are named (L9, step 5's D9): the pizzeria's and the holder's names,
never anyone else, and no user or Discord id is kept. "It's here" reaches the people with a pizza
through Notify; the message pings nobody. Every container reads every event and records it; the
order's `revision` keeps a late event from overwriting a newer state."""

from __future__ import annotations

import json
from typing import Any

from canccu_kit import Event
from canccu_kit.access import TenantContext

from .clock import hhmm
from .deps import Deps
from .guard import guarded, strip_foreign_links

KIND = "food_order"
FINAL = frozenset({"done", "cancelled"})
STEPS = (("open", "open"), ("closed", "closed"), ("placed", "called in"), ("arrived", "here"))
REACHED = {"open": 1, "closed": 2, "placed": 3, "arrived": 4, "done": 4}


def _state(order: dict[str, Any], last_call: bool) -> dict[str, Any]:
    holder = order.get("holder") or {}
    return {
        "seq": order.get("seq"),
        "pizzeria": str((order.get("pizzeria") or {}).get("name") or ""),
        "state": str(order.get("state") or ""),
        "closes_at": order.get("closes_at") or order.get("target_at"),
        "estimate_at": order.get("estimate_at"),
        "pickup": order.get("pickup"),
        "pizza_count": int(order.get("pizza_count") or 0),
        "holder": holder.get("name") if isinstance(holder.get("name"), str) else None,
        "revision": int(order.get("revision") or 0),
        "last_call": last_call,
    }


async def _order(d: Deps, tenant: str, event: Event) -> None:
    order = event.data.get("order") or {}
    key = str(order.get("id") or "")
    if not key:
        return
    async with d.db.tenant(tenant) as conn:
        kept = await conn.fetchval(
            "SELECT state FROM bot_posts WHERE kind = $1 AND key = $2 FOR UPDATE", KIND, key
        )
        before = None if kept is None else json.loads(kept)
        if before is not None and before["revision"] > int(order.get("revision") or 0):
            return  # a late event: the message already shows a newer state
        last_call = event.type == "pizza.order.closing" or bool(
            before and before["last_call"] and order.get("state") == "open"
        )
        state = json.dumps(_state(order, last_call))
        if before is not None:
            await conn.execute(
                "UPDATE bot_posts SET state = $1::jsonb, version = version + 1, updated_at = $2"
                " WHERE kind = $3 AND key = $4",
                state,
                d.now(),
                KIND,
                key,
            )
        else:
            channel = await conn.fetchval(
                "SELECT target_id FROM bot_purposes WHERE purpose = 'food'"
            )
            if channel is None or order.get("state") in FINAL:
                return  # no food channel, or an order that ended before the bot saw it
            await conn.execute(
                "INSERT INTO bot_posts (kind, key, channel_id, title, updated_at, state, version)"
                " VALUES ($1, $2, $3, '', $4, $5::jsonb, 1) ON CONFLICT DO NOTHING",
                KIND,
                key,
                channel,
                d.now(),
                state,
            )
        await board_changed(conn)


async def _count(d: Deps, tenant: str, data: dict[str, Any]) -> None:
    """A pizza added or taken out: only the order's count moves; the person is never kept."""
    async with d.db.tenant(tenant) as conn:
        await conn.execute(
            "UPDATE bot_posts SET state = state || jsonb_build_object('pizza_count', $1::int,"
            " 'revision', $2::bigint), version = version + 1"
            " WHERE kind = $3 AND key = $4 AND (state->>'revision')::bigint < $2::bigint",
            int(data.get("pizza_count") or 0),
            int(data.get("order_revision") or 0),
            KIND,
            str(data.get("order_id") or ""),
        )


async def board_changed(conn: Any) -> None:
    await conn.execute("UPDATE bot_posts SET version = version + 1 WHERE kind = 'board'")


async def on_pizza(d: Deps, event: Event) -> None:
    """Pizza's events, on the event's stream, inside its tenant."""
    if event.tenant is None:
        return
    ctx = await d.tenants.by_id(event.tenant)
    if ctx is None or ctx["status"] == "archived":
        return
    if event.type.startswith("pizza.order.") and isinstance(event.data.get("order"), dict):
        await _order(d, event.tenant, event)
    elif event.type in ("pizza.item.added", "pizza.item.removed"):
        await _count(d, event.tenant, event.data)


def _pizzas(n: int) -> str:
    return "1 pizza" if n == 1 else f"{n} pizzas"


def _lines(state: dict[str, Any], tz: str) -> list[str]:
    step, count = state["state"], _pizzas(state["pizza_count"])
    holder = f"held by {state['holder']}" if state["holder"] else ""
    if step == "open" and state["last_call"]:
        facts = [f"Last call: closes {hhmm(state['closes_at'], tz)}", count, holder]
    elif step == "open":
        facts = [f"Open until {hhmm(state['closes_at'], tz)}", count, holder]
    elif step == "closed":
        facts = ["Closed", count, holder]
    elif step == "placed":
        about = hhmm(state["estimate_at"], tz)
        facts = ["Called in", f"about {about}" if about else "", count, holder]
    elif step == "arrived":
        facts = ["It's here", f"pick up at {state['pickup']}" if state["pickup"] else ""]
    elif step == "done":
        facts = [f"Done · {count} handed out"]
    else:
        return ["Cancelled"]
    reached = REACHED.get(step, 0)
    dots = "  ".join(f"{'●' if i < reached else '○'} {name}" for i, (_, name) in enumerate(STEPS))
    return [" · ".join(f for f in facts if f), dots]


def message(
    ctx: TenantContext, state: dict[str, Any], key: str, color: int | None, page: Any
) -> dict[str, Any]:
    """The order's message; `page(path)` is the event's page URL, or None without a hostname."""
    hosts = [] if ctx["primary_hostname"] is None else [ctx["primary_hostname"]]
    title = f"Order {state['seq']} · {state['pizzeria']}"
    lines = _lines(state, ctx["time_zone"])
    embed: dict[str, Any] = {
        "title": strip_foreign_links(title, hosts)[:256],
        "description": strip_foreign_links("\n".join(lines), hosts),
    }
    if color is not None:
        embed["color"] = color
    body: dict[str, Any] = {"content": "", "embeds": [embed], "components": []}
    step = state["state"]
    label, path = (
        ("Add a pizza", f"/pizza/orders/{key}/add")
        if step == "open"
        else ("My order", f"/pizza/orders/{key}")
    )
    url = None if step in FINAL else page(path)
    if url is not None:
        button = {"type": 2, "style": 5, "label": label, "url": url}
        body["components"] = [{"type": 1, "components": [button]}]
    return guarded(body)
