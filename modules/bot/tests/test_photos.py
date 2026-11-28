""" "Send to the screen" and "Remove from the screen" (U12, U13, D15 of the step 6 plan; mockup 09):
the crew with the photos right sends a message's picture through Screen's photo API with the
message id as `source_ref`; a Discord name never goes with it."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from conftest import Env
from crew import CDN, CREW, World, buttons, click, make_world, menu

PHOTOS = "/api/screen/photos"
RIGHT = "screen.photos.write"
SEND, REMOVE = "Send to the screen", "Remove from the screen"
MESSAGE: dict[str, Any] = {
    "id": "100000000000007001",
    "channel_id": "100000000000007000",
    "content": "Our team after match 2! <@100000000000000905> https://evil.example.net/x",
    "timestamp": "2026-11-27T18:24:00+00:00",
    "author": {"id": "100000000000000905", "username": "player_two", "global_name": "Player Two"},
    "attachments": [
        {
            "id": "1",
            "filename": "team.jpg",
            "content_type": "image/jpeg",
            "size": 9,
            "url": CDN,
        }
    ],
}


@pytest.fixture
def world(env: Env) -> World:
    w = make_world(env, {"screen.photos": True})
    w.outside.rights[CREW] = {RIGHT}
    w.outside.files[CDN] = b"jpeg-data"
    w.outside.on("screen", "POST", PHOTOS, RIGHT, lambda r: httpx.Response(201, json={"id": "ph1"}))
    w.outside.on("screen", "DELETE", f"{PHOTOS}/ph1", RIGHT, None)
    return w


def form(request: httpx.Request) -> dict[str, str]:
    """The multipart form's text fields and the file's bytes."""
    body = request.read().decode("latin-1")
    fields: dict[str, str] = {}
    for part in body.split("--" + request.headers["content-type"].split("boundary=")[1]):
        if 'name="' not in part:
            continue
        name = part.split('name="')[1].split('"')[0]
        fields[name] = part.split("\r\n\r\n", 1)[1].rsplit("\r\n", 1)[0]
    return fields


async def test_send_puts_the_picture_on_the_wall_without_a_discord_name(world: World) -> None:
    await world.run(menu(SEND, MESSAGE, user=CREW))
    [call] = world.outside.calls
    sent = form(call)
    assert sent == {
        "posted_at": "2026-11-27T18:24:00+00:00",
        "source_ref": "100000000000007001",
        "caption": "Our team after match 2!",
        "file": "jpeg-data",
    }
    assert world.shown["content"] == (
        "On the photo wall: “Our team after match 2!”.\n"
        "It pops in for 10 seconds on zones that pop new photos."
    )
    assert world.shown["allowed_mentions"] == {"parse": []}
    assert list(buttons(world.shown)) == ["Remove"]


async def test_the_remove_button_and_the_menu_take_it_off_the_wall(world: World) -> None:
    await world.run(menu(SEND, MESSAGE, user=CREW))
    await world.run(click(buttons(world.shown)["Remove"]["custom_id"], user=CREW))
    assert world.shown["content"] == "Removed from the photo wall."
    await world.run(menu(REMOVE, MESSAGE, user=CREW))
    assert world.shown["content"] == "That message's picture is not on the photo wall."
    await world.run(menu(SEND, MESSAGE, user=CREW))
    await world.run(menu(REMOVE, MESSAGE, user=CREW))  # another container: Valkey keeps the id
    assert world.shown["content"] == "Removed from the photo wall."
    deletes = [c.url.path for c in world.outside.calls if c.method == "DELETE"]
    assert deletes == [f"{PHOTOS}/ph1", f"{PHOTOS}/ph1"]


async def test_the_same_picture_twice_is_already_on_the_wall(world: World) -> None:
    exists = {"error": {"code": "photo_exists", "message": "x"}}
    world.outside.on("screen", "POST", PHOTOS, RIGHT, lambda r: httpx.Response(409, json=exists))
    await world.run(menu(SEND, MESSAGE, user=CREW))
    assert world.shown["content"] == "That picture is already on the photo wall."


async def test_a_message_without_a_picture_sends_nothing(world: World) -> None:
    await world.run(menu(SEND, {**MESSAGE, "attachments": []}, user=CREW))
    assert world.shown["content"] == "That message has no picture to send."
    assert world.outside.calls == []


async def test_a_file_off_discords_host_is_never_fetched(world: World) -> None:
    inside = {**MESSAGE["attachments"][0], "url": "https://screen:8080/internal/x.jpg"}
    await world.run(menu(SEND, {**MESSAGE, "attachments": [inside]}, user=CREW))
    assert world.shown["content"] == "The photo wall does not take that kind of picture."
    assert world.outside.calls == []


async def test_without_the_photos_right_the_menu_says_which(world: World) -> None:
    await world.run(menu(SEND, MESSAGE))
    assert world.shown["content"] == (
        "You need the Photos right for “Send to the screen”. Ask an event admin."
    )


async def test_the_menus_are_off_with_the_photo_wall(world: World) -> None:
    world.env.contexts["ev-a"]["flags"] = {}
    await world.run(menu(SEND, MESSAGE, user=CREW))
    assert world.answers[-1]["data"]["content"] == (
        "“Send to the screen” is not on at Demo Event. Ask the crew; the command goes away"
        " within a minute."
    )


def test_the_menus_register_as_message_commands() -> None:
    from canccu_bot.photos import REMOVE as REMOVE_COMMAND
    from canccu_bot.photos import SEND as SEND_COMMAND

    assert SEND_COMMAND.payload() == {
        "name": SEND,
        "type": 3,
        "name_localizations": {"fi": "Lähetä näytölle"},
    }
    assert REMOVE_COMMAND.payload()["type"] == 3
