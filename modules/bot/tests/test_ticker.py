"""`/ticker` (0018, D14 of the step 6 plan; mockup 09): set, stop, status and the weekly windows on
Screen's ticker, as the person; its replies quote the line through the guard."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from conftest import Env
from crew import CREW, World, buttons, click, make_world, slash, submit

from canccu_bot import days

TICKER = "/api/screen/ticker"
WINDOWS = "/api/screen/ticker/windows"
RIGHT = "screen.ticker.write"
LINE = "Pizza last call at 21:00 · Quiet hours from 22:00"
BREAKFAST: dict[str, Any] = {"id": "w1", "text": "Breakfast in the café", "days": [6, 7]}
BREAKFAST |= {"start_minute": 540, "end_minute": 660}


def echo(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={**json.loads(request.read()), "source": "bot"})


def added(request: httpx.Request) -> httpx.Response:
    return httpx.Response(201, json={"id": "w2", **json.loads(request.read())})


@pytest.fixture
def world(env: Env) -> World:
    w = make_world(env)
    w.outside.rights[CREW] = {RIGHT}
    w.outside.on("screen", "PUT", TICKER, RIGHT, echo)
    w.outside.on("screen", "DELETE", TICKER, RIGHT, None)
    now = {"text": LINE, "until": "2026-11-27T19:00:00Z", "source": "bot"}
    w.outside.on("screen", "GET", TICKER, RIGHT, now)
    w.outside.on("screen", "GET", WINDOWS, RIGHT, {"windows": [BREAKFAST]})
    w.outside.on("screen", "POST", WINDOWS, RIGHT, added)
    w.outside.on("screen", "DELETE", f"{WINDOWS}/w1", RIGHT, None)
    return w


def ticker(sub: str, options: dict[str, Any] | None = None, **kw: Any) -> dict[str, Any]:
    return slash("ticker", sub, options, user=CREW, **kw)


async def test_set_puts_the_line_until_the_time_in_the_events_zone(world: World) -> None:
    await world.run(ticker("set", {"text": LINE, "until": "21:00"}))
    [sent] = world.outside.bodies("screen", "PUT", TICKER)
    assert sent == {"text": LINE, "until": "2026-11-27T21:00:00+02:00"}
    assert world.shown["content"] == f"The ticker says “{LINE}” on every screen until 21:00."
    assert list(buttons(world.shown)) == ["Stop now", "Keep until …"]


async def test_a_time_already_past_today_means_tomorrow(world: World) -> None:
    await world.run(ticker("set", {"text": "Doors", "until": "09:30"}))  # it is 12:00 there
    [sent] = world.outside.bodies("screen", "PUT", TICKER)
    assert sent["until"] == "2026-11-28T09:30:00+02:00"


async def test_set_without_a_time_runs_until_stopped(world: World) -> None:
    await world.run(ticker("set", {"text": "Doors"}))
    assert world.outside.bodies("screen", "PUT", TICKER) == [{"text": "Doors", "until": None}]
    assert (
        world.shown["content"] == "The ticker says “Doors” on every screen until someone stops it."
    )


async def test_a_bad_time_is_explained_and_sends_nothing(world: World) -> None:
    await world.run(ticker("set", {"text": "Doors", "until": "9pm"}))
    assert world.shown["content"] == "Write the time as HH:MM, like 21:00."
    assert world.outside.calls == []


async def test_the_reply_quoting_the_line_pings_nobody_and_links_nowhere(world: World) -> None:
    await world.run(ticker("set", {"text": "@everyone see https://evil.example.net now"}))
    shown = world.shown
    assert shown["allowed_mentions"] == {"parse": []}
    assert "evil.example.net" not in shown["content"]


async def test_stop_now_and_keep_until(world: World) -> None:
    await world.run(ticker("set", {"text": LINE, "until": "21:00"}))
    choices = buttons(world.shown)
    await world.run(click(choices["Keep until …"]["custom_id"], user=CREW))
    form = world.answers[-1]
    assert form["type"] == 9
    await world.run(submit(form["data"]["custom_id"], {"until": "22:30"}, user=CREW))
    assert world.outside.bodies("screen", "PUT", TICKER)[-1] == {
        "text": LINE,
        "until": "2026-11-27T22:30:00+02:00",
    }
    await world.run(click(choices["Stop now"]["custom_id"], user=CREW))
    assert world.shown["content"] == "The ticker is cleared on every screen."
    assert len(world.outside.bodies("screen", "DELETE", TICKER)) == 1


async def test_stop_clears_the_ticker(world: World) -> None:
    await world.run(ticker("stop"))
    assert world.shown["content"] == "The ticker is cleared on every screen."


async def test_status_shows_the_line_and_the_windows(world: World) -> None:
    await world.run(ticker("status"))
    assert world.shown["content"] == (
        f"**The ticker now**\n“{LINE}”\nuntil 21:00\n"
        "Windows: Sat and Sun 09:00\N{EN DASH}11:00 “Breakfast in the café”"
    )


async def test_schedule_add_takes_days_and_times(world: World) -> None:
    options = {"days": "Sunday", "start": "12:00", "end": "13:00", "text": "Doors close at 13:00"}
    await world.run(ticker("add", options, group="schedule"))
    [sent] = world.outside.bodies("screen", "POST", WINDOWS)
    assert sent == {
        "text": "Doors close at 13:00",
        "days": [7],
        "start_minute": 720,
        "end_minute": 780,
    }
    assert world.shown["content"] == (
        "Added: Sun 12:00\N{EN DASH}13:00 “Doors close at 13:00”.\n"
        "It repeats Sundays; remove it with /ticker schedule remove."
    )


@pytest.mark.parametrize(
    ("options", "said"),
    [
        ({"days": "someday", "start": "12:00", "end": "13:00"}, "Write the days like"),
        ({"days": "sat", "start": "13:00", "end": "12:00"}, "The end must be after the start."),
        ({"days": "sat", "start": "noon", "end": "13:00"}, "Write the time as HH:MM"),
    ],
)
async def test_schedule_add_explains_what_it_cannot_read(
    world: World, options: dict[str, str], said: str
) -> None:
    await world.run(ticker("add", {**options, "text": "x"}, group="schedule"))
    assert world.shown["content"].startswith(said)
    assert world.outside.calls == []


async def test_schedule_list_and_remove_by_number(world: World) -> None:
    await world.run(ticker("list", group="schedule"))
    assert world.shown["content"] == "1. Sat and Sun 09:00\N{EN DASH}11:00 “Breakfast in the café”"
    await world.run(ticker("remove", {"number": 2}, group="schedule"))
    assert world.shown["content"] == (
        "There is no window number 2. See them with /ticker schedule list."
    )
    await world.run(ticker("remove", {"number": 1}, group="schedule"))
    assert world.shown["content"] == (
        "Removed: Sat and Sun 09:00\N{EN DASH}11:00 “Breakfast in the café”."
    )
    assert [c.url.path for c in world.outside.calls if c.method == "DELETE"] == [f"{WINDOWS}/w1"]


async def test_someone_without_the_ticker_right_is_told_which(world: World) -> None:
    await world.run(slash("ticker", "stop"))
    assert world.shown["content"] == "You need the Ticker right for /ticker. Ask an event admin."


@pytest.mark.parametrize(
    ("said", "parsed"),
    [
        ("Sat", [6]),
        ("Sat and Sun", [6, 7]),
        ("sat, sun", [6, 7]),
        ("fri-sun", [5, 6, 7]),
        ("sat-mon", [1, 6, 7]),
        ("la ja su", [6, 7]),
        ("every day", [1, 2, 3, 4, 5, 6, 7]),
        ("someday", None),
        ("", None),
    ],
)
def test_days_are_read_as_people_type_them(said: str, parsed: list[int] | None) -> None:
    assert days.parse(said) == parsed


def test_days_are_said_short_and_as_they_repeat() -> None:
    assert days.said([1, 3, 5], "en") == "Mon, Wed and Fri"
    assert days.said([6, 7], "fi") == "la ja su"
    assert days.repeats([6, 7], "en") == "Saturdays and Sundays"
    assert days.said(list(range(1, 8)), "en") == "Every day"


def test_the_schedule_commands_register_as_a_group() -> None:
    from canccu_bot.ticker import TICKER_COMMAND

    options = TICKER_COMMAND.payload()["options"]
    assert [(o["name"], o["type"]) for o in options] == [
        ("set", 1),
        ("stop", 1),
        ("status", 1),
        ("schedule", 2),
    ]
    assert [(o["name"], o["type"]) for o in options[3]["options"]] == [
        ("add", 1),
        ("list", 1),
        ("remove", 1),
    ]
    assert options[3]["options"][2]["options"][0]["type"] == 4  # the number is an integer
