"""The attendees' commands (U1 of the step 6 plan; mockup 07): `/food`, `/now`, `/hub` and
`/privacy`, each a private answer with a link button to its page, read as the person; and the kind
"no" answers: feature off, no account, no answer in time."""

from __future__ import annotations

from typing import Any

import pytest
from conftest import Env
from crew import CREW, STRANGER, World, buttons, make_world, slash
from test_framework import HOST

ORDERS = "/api/pizza/orders"
OPEN = {
    "id": "o3",
    "seq": 3,
    "state": "open",
    "pizzeria": {"id": "p1", "name": "Demo Pizzeria", "service": "takeaway"},
    "closes_at": "2026-11-27T18:45:00Z",
    "pizza_count": 2,
    "holder": {"user_id": "u5", "name": "Player Five"},
    "mine": [],
}
PLACED = {
    "id": "o2",
    "seq": 2,
    "state": "placed",
    "pizzeria": {"id": "p2", "name": "Demo Trattoria", "service": "takeaway"},
    "closes_at": "2026-11-27T18:00:00Z",
    "estimate_at": "2026-11-27T18:50:00Z",
    "pizza_count": 6,
    "holder": None,
    "mine": [{"id": "i1"}],
}
DONE = {**OPEN, "id": "o1", "seq": 1, "state": "done"}


@pytest.fixture
def world(env: Env) -> World:
    return make_world(env, {"pizza.enabled": True})


async def test_food_shows_the_open_orders_and_links_to_the_page(world: World) -> None:
    world.outside.on("pizza", "GET", ORDERS, None, {"day": "x", "orders": [OPEN, PLACED, DONE]})
    await world.run(slash("food"))
    assert world.answers == [{"type": 5, "data": {"flags": 64}}]  # private, deferred at once
    assert world.text == (
        "Food at Demo Event\n"
        "**Order 3 · Demo Pizzeria** · open until 20:45\n"
        "2 pizzas so far · held by Player Five\n\n"
        "**Order 2 · Demo Trattoria** · called in, about 20:50\n"
        "6 pizzas so far\n"
        "You have 1 pizza in it"
    )
    links = buttons(world.shown)
    assert links["Add a pizza"]["url"] == f"https://{HOST}/pizza/orders/o3/add"
    assert links["My order"]["url"] == f"https://{HOST}/pizza/orders/o2"
    assert all(b["style"] == 5 for b in links.values())
    [call] = world.outside.calls
    assert call.headers["x-canccu-acting"] == "acting-100000000000000901"


async def test_food_with_no_order_open_links_the_food_page(world: World) -> None:
    world.outside.on("pizza", "GET", ORDERS, None, {"day": "x", "orders": [DONE]})
    await world.run(slash("food", locale="fi"))
    assert world.shown["content"] == (
        "Tapahtumassa Demo Event ei ole juuri nyt avoimia ruokatilauksia."
    )
    assert buttons(world.shown)["Ruokasivu"]["url"] == f"https://{HOST}/pizza/"


async def test_other_peoples_names_in_food_ping_nobody_and_link_nowhere(world: World) -> None:
    holder = {"user_id": "u5", "name": "@everyone see https://evil.example.net/x"}
    order = {**OPEN, "holder": holder, "pizzeria": {**OPEN["pizzeria"], "name": "www.bad.test"}}
    world.outside.on("pizza", "GET", ORDERS, None, {"day": "x", "orders": [order]})
    await world.run(slash("food"))
    shown = world.shown
    assert shown["allowed_mentions"] == {"parse": []}
    assert "evil.example.net" not in world.text and "bad.test" not in world.text


async def test_now_shows_now_and_next_and_the_run_of_show(world: World) -> None:
    current = {"title": "Match 3", "location": "on the stage", "starts_at": "2026-11-27T18:00:00Z"}
    later = {"title": "Pizza last call", "starts_at": "2026-11-27T19:00:00Z", "location": None}
    answer = {"time": "x", "agenda_version": 4, "current": [current], "next": [later]}
    world.outside.on("agenda", "GET", "/api/agenda/now", None, answer)
    await world.run(slash("now"))
    assert world.text == (
        "Now at Demo Event\nNow · Match 3 · on the stage\nNext · 21:00 · Pizza last call"
    )
    assert buttons(world.shown)["Run of show"]["url"] == f"https://{HOST}/notify/"


async def test_now_with_nothing_on_says_so(world: World) -> None:
    answer = {"time": "x", "agenda_version": 4, "current": [], "next": []}
    world.outside.on("agenda", "GET", "/api/agenda/now", None, answer)
    await world.run(slash("now"))
    assert world.shown["content"] == "Nothing is on the run of show right now."


@pytest.mark.parametrize(
    ("command", "said", "label", "path"),
    [
        (
            "hub",
            "The hub has your orders, your matches and the notifications you chose.",
            "Open the hub",
            "/notify/",
        ),
        (
            "privacy",
            "Hide your activity, and see and take back what Demo Event keeps about you, on the"
            " privacy page.",
            "Privacy page",
            "/notify/privacy",
        ),
    ],
)
async def test_hub_and_privacy_point_to_their_page(
    world: World, command: str, said: str, label: str, path: str
) -> None:
    await world.run(slash(command))
    assert world.shown["content"] == said
    assert buttons(world.shown)[label]["url"] == f"https://{HOST}{path}"
    assert world.outside.calls == []  # a door only: nothing is read


async def test_food_is_not_on_when_its_feature_is_off(world: World) -> None:
    world.env.contexts["ev-a"]["flags"] = {}
    await world.run(slash("food"))
    assert world.answers[-1]["data"]["content"] == (
        "/food is not on at Demo Event. Ask the crew; the command goes away within a minute."
    )
    assert world.outside.calls == []


async def test_someone_without_an_account_is_asked_to_sign_in(world: World) -> None:
    await world.run(slash("food", user=STRANGER))
    assert world.shown["content"] == (
        "Sign in to Demo Event once to use /food. Then your roles bring the rights."
    )
    assert buttons(world.shown)["Sign in"]["url"] == f"https://{HOST}/admin/sign-in"


async def test_a_slow_module_says_nothing_was_sent(world: World) -> None:
    world.outside.slow = True
    world.outside.on("pizza", "GET", ORDERS, None, {"day": "x", "orders": []})
    await world.run(slash("food", user=CREW))
    assert world.shown["content"] == (
        "Demo Event did not answer in time. Nothing was sent. Try again in a moment."
    )


def registered(world: World) -> list[str]:
    from canccu_bot import commands

    d: Any = type("D", (), {"commands": commands.COMMANDS})()
    return [c["name"] for c in commands.wanted(d, world.env.contexts["ev-a"])]


async def test_the_commands_follow_the_events_flags(world: World) -> None:
    assert registered(world) == ["food", "now", "hub", "privacy", "announce", "ticker"]
    world.env.contexts["ev-a"]["flags"] = {"screen.photos": True}
    assert registered(world) == [
        "now",
        "hub",
        "privacy",
        "announce",
        "ticker",
        "Send to the screen",
        "Remove from the screen",
    ]
