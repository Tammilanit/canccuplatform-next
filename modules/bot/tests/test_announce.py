"""`/announce` (U3 of the step 6 plan; mockup 08): the form at once, a private preview with the
level and where it goes, Send through Moments' API as the person; Back, the level and "Open the
composer"; a draft only its writer can send."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from conftest import Env
from crew import CREW, PLAYER, World, buttons, click, make_world, slash, submit
from test_framework import HOST

PREVIEW = "/api/moments/announcements/preview"
SEND = "/api/moments/announcements"
RIGHT = "moments.announce"


def previewed(request: httpx.Request) -> httpx.Response:
    sent = json.loads(request.read())
    return httpx.Response(
        200,
        json={
            "title": sent["title"],
            "body": sent["body"],
            "regions": ["rail", "ticker"],
            "line": f"{sent['title']} · {sent['body']}",
            "push": {"title": sent["title"], "body": sent["body"], "urgent": False},
            "discord": {"text": sent["title"]},
            "zones": [],
        },
    )


@pytest.fixture
def world(env: Env) -> World:
    w = make_world(env)
    w.outside.rights[CREW] = {RIGHT}
    w.outside.on("moments", "POST", PREVIEW, RIGHT, previewed)
    w.outside.on("moments", "POST", SEND, RIGHT, {"id": "a1", "title": "Match 3 starts at 20:30"})
    return w


async def write(world: World, **who: Any) -> dict[str, Any]:
    """`/announce`, then the form sent: the preview as the person sees it."""
    await world.run(slash("announce", **who))
    form = world.answers[-1]
    values = {"title": "Match 3 starts at 20:30", "body": "Teams to the stage, please."}
    await world.run(submit(form["data"]["custom_id"], values, **who))
    return world.shown


async def test_the_form_opens_at_once_without_a_call(world: World) -> None:
    await world.run(slash("announce", user=CREW))
    [form] = world.answers
    assert form["type"] == 9 and form["data"]["title"] == "Announce to Demo Event"
    fields = [row["components"][0] for row in form["data"]["components"]]
    assert [(f["custom_id"], f["max_length"], f["style"]) for f in fields] == [
        ("title", 60, 1),
        ("body", 140, 2),
    ]
    assert world.outside.calls == []


async def test_the_preview_says_what_goes_out_and_where(world: World) -> None:
    shown = await write(world, user=CREW)
    assert world.text == (
        "Ready to send. This is what goes out:\nLevel: Info\n"
        "Match 3 starts at 20:30\nTeams to the stage, please.\n"
        "Screens: all zones, info · Ticker · Discord · Push"
    )
    assert list(buttons(shown)) == [
        "Info",
        "Important",
        "Urgent",
        "Send now",
        "Back",
        "Open the composer",
    ]
    assert buttons(shown)["Open the composer"]["url"] == f"https://{HOST}/moments/announce"
    [sent] = world.outside.bodies("moments", "POST", PREVIEW)
    assert sent == {
        "title": "Match 3 starts at 20:30",
        "body": "Teams to the stage, please.",
        "level": "info",
        "channels": {"screen": True, "ticker": True, "discord": True, "push": True},
        "zones": [],
        "when": {"mode": "now"},
    }
    assert world.outside.bodies("moments", "POST", SEND) == []  # a preview saves nothing


async def test_send_now_sends_through_moments_once_with_the_level(world: World) -> None:
    shown = await write(world, user=CREW)
    await world.run(click(buttons(shown)["Urgent"]["custom_id"], user=CREW))
    assert "Level: Urgent" in world.text
    data = click(buttons(world.shown)["Send now"]["custom_id"], user=CREW)
    await world.run(data)
    [sent] = world.outside.bodies("moments", "POST", SEND)
    assert sent["level"] == "urgent" and sent["title"] == "Match 3 starts at 20:30"
    [call] = [c for c in world.outside.calls if c.url.path == SEND]
    assert call.headers["idempotency-key"] == data["id"]
    assert world.shown["content"] == (
        "Sent to Demo Event: “Match 3 starts at 20:30”. Edit or withdraw it in the composer."
    )


async def test_back_opens_the_form_again_with_the_draft(world: World) -> None:
    shown = await write(world, user=CREW)
    await world.run(click(buttons(shown)["Back"]["custom_id"], user=CREW))
    form = world.answers[-1]
    assert form["type"] == 9
    values = [row["components"][0]["value"] for row in form["data"]["components"]]
    assert values == ["Match 3 starts at 20:30", "Teams to the stage, please."]


async def test_a_draft_is_its_writers_only(world: World) -> None:
    shown = await write(world, user=CREW)
    world.outside.rights[PLAYER] = {RIGHT}
    await world.run(click(buttons(shown)["Send now"]["custom_id"], user=PLAYER))
    assert world.shown["content"] == "This draft is old. Run /announce again."
    assert world.outside.bodies("moments", "POST", SEND) == []


async def test_someone_without_the_right_is_told_in_words(world: World) -> None:
    await write(world)
    assert world.shown["content"] == (
        "You need the Announce right for /announce. Ask an event admin."
    )


async def test_moments_refusing_the_text_says_how_to_fix_it(world: World) -> None:
    refused = {"error": {"code": "invalid_request", "message": "unknown placeholder"}}
    world.outside.on("moments", "POST", PREVIEW, RIGHT, lambda r: httpx.Response(400, json=refused))
    await write(world, user=CREW)
    assert world.shown["content"].startswith("Moments did not take that text")
