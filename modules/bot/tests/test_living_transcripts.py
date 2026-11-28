"""The living messages' transcripts against mockup 10 (docs/briefs/step-6-bot/10-living-messages):
the pinned board at three moments of a Saturday, order 2 from open to "it's here" as one message,
and the run-of-show post on a phone. Times are the mockup's, in Helsinki.

Where the mockup's frames disagree, the transcript keeps one rule: the holder is named on every
line of an order that has one until it is here (frame C2 names them on a called-in order, frame
B leaves them off), and an empty food line reads "nothing open" (frame A says "nothing open yet"
once)."""

from __future__ import annotations

from datetime import UTC, datetime

from canccu_kit import Event
from conftest import Env
from living_world import item, text, world
from test_run_of_show import DOORS

from canccu_bot import run_of_show


def at(hhmm: str) -> datetime:
    """A time of Saturday 28 November in Helsinki (UTC+2)."""
    hour, minute = (int(p) for p in hhmm.split(":"))
    return datetime(2026, 11, 28, hour - 2, minute, tzinfo=UTC)


def utc(hhmm: str) -> str:
    return at(hhmm).isoformat().replace("+00:00", "Z")


async def test_the_board_through_an_evening(env: Env) -> None:
    w = await world(env)
    w.clock.at = at("19:02")
    w.agenda.current = [item("Doors open", utc("18:00"), "café and hall", kind="doors")]
    w.agenda.next = [item("Match 2", utc("19:30"), "Space Racer")]
    await w.editor.tick()
    assert text(w.board()[0]) == (
        "Demo Event · Saturday\n"
        "Now · Doors open · café and hall\n"
        "Next · 19:30 · Match 2 · Space Racer\n"
        "Food · nothing open\n"
        "Edited 19:02 · the run of show, live"
    )

    w.clock.at = at("20:14")
    w.agenda.current = [item("Match 3 · Demo Arena", utc("20:10"), "on the stage")]
    w.agenda.next = [item("Pizza last call", utc("21:00"))]
    await w.order_event("placed", state="placed", revision=5, estimate_at=utc("20:50"))
    three = {"id": "po_3", "seq": 3, "closes_at": utc("20:45"), "target_at": utc("20:45")}
    await w.order_event("opened", **three)
    await w.editor.tick()
    assert text(w.board()[0]) == (
        "Demo Event · Saturday\n"
        "Now · Match 3 · Demo Arena · on the stage\n"
        "Next · 21:00 · Pizza last call\n"
        "Food · order 3 open until 20:45 · order 2 on the way\n"
        "Edited 20:14 · the run of show, live"
    )

    w.clock.at = at("23:30")
    quiet = item("Quiet hours in the hall", utc("23:00"), kind="quiet_hours", ends_at=utc("08:00"))
    w.agenda.current = [quiet]
    w.agenda.next = [item("Breakfast in the café", utc("09:00"))]
    await w.order_event("done", state="done", revision=9)
    await w.order_event("done", state="done", revision=9, **three)
    await w.editor.tick()
    [board] = w.board()
    assert text(board) == (
        "Demo Event · Saturday\n"
        "Now · Quiet hours in the hall until 08:00\n"
        "Next · 09:00 · Breakfast in the café\n"
        "Food · nothing open\n"
        "Edited 23:30 · the run of show, live"
    )
    assert w.pinned() == [board["id"]]


async def test_order_2_is_one_message_from_open_to_here(env: Env) -> None:
    w = await world(env)
    two = {"closes_at": utc("20:08"), "target_at": utc("20:08")}
    seen: list[tuple[str, str]] = []

    async def step(hhmm: str, kind: str, **changes: object) -> None:
        w.clock.at = at(hhmm)
        await w.order_event(kind, **{**two, **changes})
        await w.editor.tick()
        [message] = w.food()
        buttons = message["components"][0]["components"] if message["components"] else []
        seen.append((text(message), ", ".join(b["label"] for b in buttons)))

    await step("19:41", "opened")
    await step("19:58", "closing", pizza_count=6, revision=2)
    await step("20:12", "placed", state="placed", pizza_count=7, revision=4,
               estimate_at=utc("20:50"))  # fmt: skip
    await step("20:52", "arrived", state="arrived", pizza_count=7, revision=5,
               pickup="the café counter")  # fmt: skip
    await step("21:30", "done", state="done", pizza_count=9, revision=6, reason="handed_out")
    title = "Order 2 · Demo Trattoria\n"
    assert seen == [
        (
            title + "Open until 20:08 · 3 pizzas · held by Player Two\n"
            "● open  ○ closed  ○ called in  ○ here",
            "Add a pizza",
        ),
        (
            title + "Last call: closes 20:08 · 6 pizzas · held by Player Two\n"
            "● open  ○ closed  ○ called in  ○ here",
            "Add a pizza",
        ),
        (
            title + "Called in · about 20:50 · 7 pizzas · held by Player Two\n"
            "● open  ● closed  ● called in  ○ here",
            "My order",
        ),
        (
            title + "It's here · pick up at the café counter\n"
            "● open  ● closed  ● called in  ● here",
            "My order",
        ),
        (title + "Done · 9 pizzas handed out\n● open  ● closed  ● called in  ● here", ""),
    ]
    assert all("@" not in t for t, _ in seen)  # nobody is pinged in the channel


async def test_the_run_of_show_post_on_a_phone(env: Env) -> None:
    await world(env)
    ctx = env.contexts["ev-a"]
    event = Event("r1", "agenda.reminder.triggered", 1, utc("17:50"), "agenda",
                  {"item": {**DOORS, "starts_at": utc("18:00")}, "lead_minutes": 10,
                   "leads_minutes": [30, 10]}, tenant="ev-a")  # fmt: skip
    post = run_of_show.post(ctx, event, 0x3366FF)
    embed = post["embeds"][0]
    lines = [embed["author"]["name"], embed["title"], embed["description"]]
    assert lines == ["Starts in 10 minutes", "Doors open", "18:00 · café and hall"]
