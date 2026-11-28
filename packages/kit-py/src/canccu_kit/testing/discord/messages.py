"""The fake's message routes: posting, editing and reading a message, pins, and direct messages
(#852). A direct message reaches only someone who shares a guild with the bot (Discord's 50007
otherwise). What people do in a guild (delete or unpin a message) is the fake's own
`delete_message` and `unpin`, since no bot request does it."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from starlette.responses import JSONResponse, Response

from .model import FakeApplication

if TYPE_CHECKING:
    from .fake import FakeDiscord


def _error(status: int, message: str, code: int) -> JSONResponse:
    return JSONResponse({"message": message, "code": code}, status_code=status)


def _unknown_message() -> JSONResponse:
    return _error(404, "Unknown Message", 10008)


def _shares_guild(fake: FakeDiscord, app: FakeApplication, user_id: str) -> bool:
    return any(app.id in g.bots and user_id in g.members for g in fake.guilds.values())


def _reachable(fake: FakeDiscord, app: FakeApplication, channel_id: str) -> JSONResponse | None:
    """None when the bot may read and post in the channel, else Discord's refusal."""
    recipient = fake.dm_channels.get(channel_id)
    if recipient is not None:
        if _shares_guild(fake, app, recipient):
            return None
        return _error(403, "Cannot send messages to this user", 50007)
    found = fake.channel(channel_id)
    if found is None or app.id not in found[0].bots:
        return _error(404 if found is None else 403, "Unknown Channel", 10003)
    return None


def _own(fake: FakeDiscord, channel_id: str, message_id: str) -> dict[str, Any] | None:
    messages = fake.messages.get(channel_id, [])
    return next((m for m in messages if m["id"] == message_id), None)


async def create_message(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    refused = _reachable(fake, app, p["channel_id"])
    if refused is not None:
        return refused
    message = {**(body or {}), "id": fake.snowflake(), "channel_id": p["channel_id"]}
    message["author"] = {"id": app.bot_user_id, "username": app.name, "bot": True}
    message["edited_timestamp"] = None
    fake.messages.setdefault(p["channel_id"], []).append(message)
    return JSONResponse(message)


async def edit_message(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    message = _own(fake, p["channel_id"], p["message_id"])
    refused = _reachable(fake, app, p["channel_id"]) is not None
    if refused or message is None or message["author"]["id"] != app.bot_user_id:
        return _unknown_message()
    message.update(body or {})
    message["edited_timestamp"] = datetime.now(UTC).isoformat()
    return JSONResponse(message)


async def get_message(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    refused = _reachable(fake, app, p["channel_id"])
    if refused is not None:
        return refused
    message = _own(fake, p["channel_id"], p["message_id"])
    return _unknown_message() if message is None else JSONResponse(message)


async def get_pins(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    refused = _reachable(fake, app, p["channel_id"])
    if refused is not None:
        return refused
    pinned = fake.pins.get(p["channel_id"], [])
    return JSONResponse([m for m in fake.messages.get(p["channel_id"], []) if m["id"] in pinned])


async def pin(fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any) -> Response:
    refused = _reachable(fake, app, p["channel_id"])
    if refused is not None:
        return refused
    if _own(fake, p["channel_id"], p["message_id"]) is None:
        return _unknown_message()
    pinned = fake.pins.setdefault(p["channel_id"], [])
    if p["message_id"] not in pinned:
        pinned.append(p["message_id"])
    return Response(status_code=204)


async def open_dm(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    recipient = str((body or {}).get("recipient_id") or "")
    user = fake.users.get(recipient)
    if user is None:
        return _error(400, "Invalid Form Body", 50035)
    channel_id = next((c for c, u in fake.dm_channels.items() if u == recipient), None)
    if channel_id is None:
        channel_id = fake.snowflake()
        fake.dm_channels[channel_id] = recipient
    recipients = [{"id": user.id, "username": user.username}]
    return JSONResponse({"id": channel_id, "type": 1, "recipients": recipients})


ROUTES = [
    ("POST", "/channels/{channel_id}/messages", create_message),
    ("GET", "/channels/{channel_id}/messages/{message_id}", get_message),
    ("PATCH", "/channels/{channel_id}/messages/{message_id}", edit_message),
    ("GET", "/channels/{channel_id}/pins", get_pins),
    ("PUT", "/channels/{channel_id}/pins/{message_id}", pin),
    ("POST", "/users/@me/channels", open_dm),
]
