"""The attendees' commands (U1 of the step 6 plan; mockup 07): each a door to the page that does
the job. `/food` and `/now` read as the person, so they see what the page would show them (their
own pizzas, the run of show's items for members); `/hub` and `/privacy` only point. Every answer
is private, short, and links to its page with a button."""

from __future__ import annotations

from typing import Any

from .clock import hhmm
from .framework import Button, Command, Context, Reply
from .guard import strip_foreign_links
from .texts import pick

SAY: dict[str, dict[str, str]] = {
    "food_title": {"en": "Food at {event}", "fi": "Ruoka: {event}"},
    "no_orders": {
        "en": "No food orders are open at {event} right now.",
        "fi": "Tapahtumassa {event} ei ole juuri nyt avoimia ruokatilauksia.",
    },
    "order": {"en": "Order {seq} · {pizzeria}", "fi": "Tilaus {seq} · {pizzeria}"},
    "open": {"en": "open until {time}", "fi": "auki {time} asti"},
    "closed": {"en": "closed, being called in", "fi": "suljettu, tilataan"},
    "placed": {"en": "called in, about {time}", "fi": "tilattu, noin {time}"},
    "placed_no_time": {"en": "called in", "fi": "tilattu"},
    "arrived": {"en": "here", "fi": "perillä"},
    "count": {"en": "{n} pizzas so far", "fi": "{n} pizzaa tähän mennessä"},
    "held": {"en": "held by {name}", "fi": "vastuuhenkilö {name}"},
    "mine": {"en": "You have {n} pizza in it", "fi": "Sinulla on siinä {n} pizza"},
    "mine_many": {"en": "You have {n} pizzas in it", "fi": "Sinulla on siinä {n} pizzaa"},
    "add": {"en": "Add a pizza", "fi": "Lisää pizza"},
    "my_order": {"en": "My order", "fi": "Oma tilaus"},
    "food_page": {"en": "Food page", "fi": "Ruokasivu"},
    "now_title": {"en": "Now at {event}", "fi": "Nyt: {event}"},
    "now": {"en": "Now", "fi": "Nyt"},
    "next": {"en": "Next", "fi": "Seuraavaksi"},
    "nothing_on": {
        "en": "Nothing is on the run of show right now.",
        "fi": "Ohjelmassa ei ole juuri nyt mitään.",
    },
    "run_of_show": {"en": "Run of show", "fi": "Ohjelma"},
    "hub": {
        "en": "The hub has your orders, your matches and the notifications you chose.",
        "fi": "Hubissa ovat tilauksesi, ottelusi ja valitsemasi ilmoitukset.",
    },
    "open_hub": {"en": "Open the hub", "fi": "Avaa hub"},
    "privacy": {
        "en": "Hide your activity, and see and take back what {event} keeps about you, on the"
        " privacy page.",
        "fi": "Piilota toimintasi sekä katso ja poista, mitä {event} säilyttää sinusta,"
        " tietosuojasivulla.",
    },
    "privacy_page": {"en": "Privacy page", "fi": "Tietosuojasivu"},
}
LIVE = ("open", "closed", "placed", "arrived")
"""An order not over yet: done and cancelled ones are not food anyone can still get."""


def say(c: Context, key: str, **values: Any) -> str:
    return pick(SAY[key], c.caller.locale).format(**values)


def link(c: Context, label: str, path: str) -> list[Button]:
    url = c.page(path)
    return [] if url is None else [Button(say(c, label), url=url, style="link")]


def _state(c: Context, order: dict[str, Any]) -> str:
    state, tz = order.get("state"), c.time_zone
    if state == "open":
        return say(c, "open", time=hhmm(order.get("closes_at"), tz))
    if state == "placed":
        at = order.get("estimate_at")
        return say(c, "placed", time=hhmm(at, tz)) if at else say(c, "placed_no_time")
    return say(c, "arrived" if state == "arrived" else "closed")


def _order(c: Context, order: dict[str, Any]) -> list[str]:
    """One order in three short lines (390 px: one fact per line). The pizzeria and the holder
    are other people's words: no link off the event's hosts."""
    pizzeria = strip_foreign_links(str((order.get("pizzeria") or {}).get("name") or ""), c.hosts)
    lines = [f"**{say(c, 'order', seq=order.get('seq'), pizzeria=pizzeria)}** · {_state(c, order)}"]
    facts = [say(c, "count", n=order.get("pizza_count", 0))]
    holder = (order.get("holder") or {}).get("name")
    if holder:
        facts.append(say(c, "held", name=strip_foreign_links(str(holder), c.hosts)))
    lines.append(" · ".join(facts))
    mine = len(order.get("mine") or [])
    if mine:
        lines.append(say(c, "mine" if mine == 1 else "mine_many", n=mine))
    return lines


async def food(c: Context) -> Reply:
    answer = await c.act("pizza", "GET", "/api/pizza/orders", None)
    orders = [o for o in (answer or {}).get("orders") or [] if o.get("state") in LIVE]
    if not orders:
        said = say(c, "no_orders", event=c.event_name)
        return Reply(said, buttons=link(c, "food_page", "/pizza/"))
    text = "\n\n".join("\n".join(_order(c, o)) for o in orders)
    embed = {"title": say(c, "food_title", event=c.event_name), "description": text}
    buttons: list[Button] = []
    joinable = next((o for o in orders if o.get("state") == "open"), None)
    if joinable is not None:
        buttons += link(c, "add", f"/pizza/orders/{joinable['id']}/add")
    mine = next((o for o in orders if o.get("mine")), None)
    if mine is not None:
        buttons += link(c, "my_order", f"/pizza/orders/{mine['id']}")
    return Reply(embeds=[embed], buttons=buttons or link(c, "food_page", "/pizza/"))


def _item(c: Context, item: dict[str, Any], with_time: bool) -> str:
    parts = [strip_foreign_links(str(item.get("title") or ""), c.hosts)]
    if with_time:
        parts.insert(0, hhmm(item.get("starts_at"), c.time_zone))
    if item.get("location"):
        parts.append(strip_foreign_links(str(item["location"]), c.hosts))
    return " · ".join(p for p in parts if p)


async def now(c: Context) -> Reply:
    answer = await c.act("agenda", "GET", "/api/agenda/now", None) or {}
    lines = [f"{say(c, 'now')} · {_item(c, i, False)}" for i in answer.get("current") or []]
    lines += [f"{say(c, 'next')} · {_item(c, i, True)}" for i in answer.get("next") or []]
    buttons = link(c, "run_of_show", "/notify/")
    if not lines:
        return Reply(say(c, "nothing_on"), buttons=buttons)
    embed = {"title": say(c, "now_title", event=c.event_name), "description": "\n".join(lines)}
    return Reply(embeds=[embed], buttons=buttons)


async def hub(c: Context) -> Reply:
    return Reply(say(c, "hub"), buttons=link(c, "open_hub", "/notify/"))


async def privacy(c: Context) -> Reply:
    return Reply(
        say(c, "privacy", event=c.event_name), buttons=link(c, "privacy_page", "/notify/privacy")
    )


FOOD = Command(
    name="food",
    flag="pizza.enabled",
    description={"en": "The food orders, and a link to order", "fi": "Ruokatilaukset ja linkki"},
    run=food,
)
NOW = Command(
    name="now",
    flag=None,
    description={"en": "What is on now and next", "fi": "Mitä nyt ja seuraavaksi"},
    run=now,
)
HUB = Command(
    name="hub",
    flag=None,
    description={"en": "Open the event's hub", "fi": "Avaa tapahtuman hub"},
    run=hub,
)
PRIVACY = Command(
    name="privacy",
    flag=None,
    description={"en": "Hide your activity, see what is kept", "fi": "Piilota toimintasi"},
    run=privacy,
)
