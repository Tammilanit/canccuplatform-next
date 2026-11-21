"""The `food` topic as the pizza module registers it (contracts/notify.md; step 5, D12): Notify
takes the registration, and its triggers turn pizza's events into the notifications the contract
names, each to whom it is for, by the registration alone."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from topics import CONTRACT

from canccu_notify import engine, registry

NOW = datetime(2026, 11, 21, 16, 0, tzinfo=UTC)
HELSINKI = ZoneInfo("Europe/Helsinki")


def food() -> dict[str, Any]:
    text = CONTRACT.read_text()
    block = re.search(r"The `food` registration in full.*?```json\n(.*?)```", text, re.S)
    assert block is not None
    value: dict[str, Any] = json.loads(block.group(1))
    return value


def order(**extra: Any) -> dict[str, Any]:
    return {
        "id": "po_1",
        "seq": 3,
        "state": "open",
        "pizzeria": {"id": "pz_1", "name": "Demo Pizzeria"},
        "closes_at": "2026-11-21T17:00:00Z",
        "pickup": None,
        "pizza_count": 9,
        **extra,
    }


def made(type_: str, data: dict[str, Any]) -> list[engine.Candidate]:
    """Every trigger of the topic on one event, as the consumer runs them."""
    reg = registry.validate("food", food())
    envelope = {"id": "e1", "type": type_, "tenant": "demo", "data": data}
    out: list[engine.Candidate] = []
    for t in reg["triggers"]:
        out += engine.evaluate("food", t, ["push", "discord_dm"], {}, envelope, NOW, HELSINKI)
    return out


def test_notify_takes_the_registration() -> None:
    reg = registry.validate("food", food())
    assert reg["owner"] == "pizza"
    assert set(reg["parts"]) == {"event", "personal"}


def test_an_opened_order_and_its_last_call_go_to_the_event_part() -> None:
    [c] = made("pizza.order.opened", {"order": order()})
    assert (c.part, c.audience, c.title, c.body) == (
        "event",
        "public",
        "Pizza order open: Demo Pizzeria",
        "Order 3 closes at 19:00",
    )
    assert c.url == "/pizza/orders/po_1"
    [last] = made("pizza.order.closing", {"order": order(), "closes_at": "2026-11-21T17:00:00Z"})
    assert (last.part, last.title, last.body) == (
        "event",
        "Order 3 is closing at 19:00",
        "Last call: add your pizza now",
    )
    assert last.url == "/pizza/orders/po_1/add"


def test_pizza_is_here_reaches_each_person_with_where_to_collect_it() -> None:
    people = {"user_ids": ["u_anni", "u_mikko"], "people": []}
    [c] = made(
        "pizza.order.arrived", {"order": order(state="arrived", pickup="Entrance table"), **people}
    )
    assert (c.part, c.user_ids) == ("personal", ("u_anni", "u_mikko"))
    assert (c.title, c.body) == ("Pizza is here: order 3", "Collect at Entrance table")
    [plain] = made("pizza.order.arrived", {"order": order(state="arrived"), **people})
    assert plain.body == "Demo Pizzeria: come and get it"


def test_a_cancelled_order_tells_its_people() -> None:
    [c] = made(
        "pizza.order.cancelled",
        {"order": order(state="cancelled"), "user_ids": ["u_anni"], "reason": "cancelled"},
    )
    assert (c.user_ids, c.title) == (("u_anni",), "Order 3 was cancelled")


def test_each_reminder_goes_to_its_one_person_in_its_own_words() -> None:
    words = {
        "open_past_target": ("Order 3 is past its close time", "/pizza/hold/po_1"),
        "closed_not_placed": ("Order 3 is not called in yet", "/pizza/hold/po_1"),
        "not_arrived": ("Has order 3 arrived?", "/pizza/hold/po_1"),
        "released": ("Nobody holds order 3", "/pizza/hold/po_1"),
        "not_collected": ("Your pizza is waiting", "/pizza/orders/po_1"),
    }
    for kind, (title, url) in words.items():
        data = {"order": order(), "kind": kind, "minutes": 30, "user_id": "u_pena"}
        [c] = made("pizza.reminder.triggered", {**data, "role": "holder"})
        assert (c.part, c.user_ids, c.title, c.url) == ("personal", ("u_pena",), title, url)
    [late] = made(
        "pizza.reminder.triggered",
        {"order": order(), "kind": "closed_not_placed", "minutes": 30, "user_id": "u_pena"},
    )
    assert late.body == "Closed 30 min ago: call Demo Pizzeria"


def test_calling_it_in_tells_each_person_when_it_is_expected() -> None:
    people = {"user_ids": ["u_anni", "u_mikko"], "people": []}
    [c] = made(
        "pizza.order.placed",
        {"order": order(state="placed", estimate_at="2026-11-21T17:30:00Z"), **people},
    )
    assert (c.part, c.user_ids, c.title) == (
        "personal",
        ("u_anni", "u_mikko"),
        "Order 3 is called in",
    )
    assert c.body == "Demo Pizzeria: expected at 19:30"
    unknown = order(state="placed", estimate_at=None)
    [plain] = made("pizza.order.placed", {"order": unknown, **people})
    assert plain.body == "Demo Pizzeria: you will hear when it is here"


def test_a_pizza_changed_or_removed_by_someone_else_tells_its_owner_only() -> None:
    item = {"order_id": "po_1", "order_seq": 3, "user_id": "u_anni"}
    [changed] = made("pizza.item.changed", {**item, "by_owner": False})
    assert (changed.user_ids, changed.title) == (("u_anni",), "Your pizza in order 3 was changed")
    [removed] = made("pizza.item.removed", {**item, "by_owner": False})
    assert (removed.title, removed.url) == (
        "Your pizza was taken out of order 3",
        "/pizza/orders/po_1",
    )
    assert made("pizza.item.removed", {**item, "by_owner": True}) == []
    assert made("pizza.item.added", {**item, "by_owner": True}) == []


def share(**extra: Any) -> dict[str, Any]:
    payer = {"user_id": "u_pena", "discord_user_id": None, "name": "Pena"}
    return {"order": order(state="done"), "user_ids": ["u_anni"], "payer": payer, **extra}


def test_a_share_says_whom_to_pay_and_never_an_amount() -> None:
    [to_payer] = made("pizza.share.ready", share(settle_to="payer"))
    assert (to_payer.user_ids, to_payer.title, to_payer.url) == (
        ("u_anni",),
        "Order 3: pay Pena your share",
        "/pizza/orders/po_1",
    )
    [to_organiser] = made("pizza.share.ready", share(settle_to="organiser"))
    assert to_organiser.title == "Order 3: your share is ready"
    assert to_organiser.body.startswith("Paid to the organiser after the event")
    [amount] = made("pizza.share.changed", share(settle_to="payer", reason="amount"))
    assert amount.title == "Order 3: your share changed"
    [pay_to] = made("pizza.share.changed", share(settle_to="payer", reason="pay_to"))
    assert (pay_to.title, pay_to.body) == (
        "Order 3: pay Pena",
        "How to pay changed: the details are on your order",
    )
    [organiser] = made("pizza.share.changed", share(settle_to="organiser", reason="pay_to"))
    assert organiser.title == "Order 3: pay the organiser"
    paid = {"order": order(state="done"), "user_id": "u_anni", "payer": share()["payer"]}
    [marked] = made("pizza.share.paid", paid)
    assert (marked.user_ids, marked.body) == (("u_anni",), "Pena has your payment marked")


def test_the_payment_reminder_has_words_for_the_person_and_for_the_payer() -> None:
    data = {"order": order(state="done"), "kind": "not_paid", "minutes": 600, "count": 2}
    [member] = made("pizza.reminder.triggered", {**data, "user_id": "u_anni", "role": "member"})
    assert (member.user_ids, member.title, member.url) == (
        ("u_anni",),
        "Order 3: not marked paid yet",
        "/pizza/orders/po_1",
    )
    [payer] = made("pizza.reminder.triggered", {**data, "user_id": "u_pena", "role": "payer"})
    assert (payer.title, payer.url) == ("Order 3: 2 not marked paid", "/pizza/hold/po_1/money")
