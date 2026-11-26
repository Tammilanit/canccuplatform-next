"""An example message for each kind of notification (#782 part C, plan D14): the first event-wide
trigger's title and body, filled with demo values in the event's time zone."""

from __future__ import annotations

import json
from datetime import date

from topics import play, schedule

from canccu_notify import custom
from canccu_notify.examples import example_for

TODAY = date(2026, 12, 4)


def test_schedule_s_example_is_the_reminder_in_the_event_zone() -> None:
    assert example_for(schedule(), "Europe/Helsinki", TODAY) == (
        "Opening ceremony at 18:00",
        "Starts in 10 min",
    )


def test_food_s_example_names_the_demo_pizzeria() -> None:
    food = {
        "key": "food",
        "parts": {"event": {"scope": "event"}, "personal": {"scope": "user"}},
        "triggers": [
            {
                "event": "pizza.order.arrived",
                "part": "personal",
                "title": "Pizza is here: order {data.order.seq}",
                "body": "Collect at {data.order.pickup}",
            },
            {
                "event": "pizza.order.opened",
                "part": "event",
                "title": "Pizza order open: {data.order.pizzeria.name}",
                "body": "Order {data.order.seq} closes at {data.order.closes_at|time}",
            },
        ],
    }
    assert example_for(food, "UTC", TODAY) == (
        "Pizza order open: Demo Pizzeria",
        "Order 3 closes at 19:30",
    )


def test_announcements_come_from_their_sample_title_and_body() -> None:
    reg = {
        "key": "announcements",
        "parts": {"event": {"scope": "event"}},
        "triggers": [
            {
                "event": "moments.announcement.sent",
                "part": "event",
                "title": "{data.title}",
                "body": "{data.body}",
            },
        ],
    }
    title, body = example_for(reg, "UTC", TODAY)
    assert title == "Doors open in 10 minutes" and body.startswith("Have your ticket")


def test_a_path_with_no_sample_shows_an_ellipsis() -> None:
    title, body = example_for(play(), "UTC", TODAY)  # personal only: its first trigger
    assert title == "… with …" and body == "Starts at …"


def test_a_custom_topic_shows_its_base_s_example() -> None:
    base = schedule()
    row = {
        "key": "custom_meals",
        "title": "Meals",
        "description": None,
        "defaults": "{}",
        "conditions": json.dumps([{"field": "data.item.kind", "op": "eq", "value": "meal"}]),
    }
    derived = custom.derive(base, row)
    assert example_for(derived, "UTC", TODAY) == example_for(base, "UTC", TODAY)


def test_a_topic_without_triggers_has_no_example() -> None:
    assert example_for({"key": "x", "parts": {}, "triggers": []}, "UTC", TODAY) == ("", "")
