"""The fake's REST API under /api/v10: a few routes, Discord's auth, rate-limit headers and 429s,
and a record of every call."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import oauth
from .model import FakeApplication, FakeRequest

if TYPE_CHECKING:
    from .fake import FakeDiscord

PREFIX = "/api/v10"
Handler = Callable[["FakeDiscord", FakeApplication, dict[str, str], Any], Awaitable[Response]]


def _error(status: int, message: str, code: int) -> JSONResponse:
    return JSONResponse({"message": message, "code": code}, status_code=status)


async def users_me(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    return JSONResponse({"id": app.bot_user_id, "username": app.name, "bot": True})


async def application_me(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    return JSONResponse({"id": app.id, "name": app.name, "bot": {"id": app.bot_user_id}})


async def gateway_bot(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    limit = {"total": 1000, "remaining": 1000, "reset_after": 0, "max_concurrency": 1}
    return JSONResponse({"url": fake.gateway_url, "shards": 1, "session_start_limit": limit})


async def create_message(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    found = fake.channel(p["channel_id"])
    if found is None or app.id not in found[0].bots:
        return _error(404 if found is None else 403, "Unknown Channel", 10003)
    message = {**(body or {}), "id": fake.snowflake(), "channel_id": p["channel_id"]}
    message["author"] = {"id": app.bot_user_id, "username": app.name, "bot": True}
    fake.messages.setdefault(p["channel_id"], []).append(message)
    return JSONResponse(message)


async def get_guild(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    guild = fake.guilds.get(p["guild_id"])
    if guild is None or app.id not in guild.bots:
        return _error(403, "Missing Access", 50001)
    return JSONResponse({"id": guild.id, "name": guild.name, "owner_id": guild.owner_id})


async def leave_guild(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    guild = fake.guilds.get(p["guild_id"])
    if guild is None or app.id not in guild.bots:
        return _error(404, "Unknown Guild", 10004)
    guild.bots.discard(app.id)
    return Response(status_code=204)


async def put_commands(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    guild = fake.guilds.get(p["guild_id"])
    if p["application_id"] != app.id or guild is None or app.id not in guild.bots:
        return _error(403, "Missing Access", 50001)
    commands = [{**c, "id": fake.snowflake(), "application_id": app.id} for c in body or []]
    guild.commands[app.id] = commands
    return JSONResponse(commands)


async def answer_interaction(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    fake.interaction_answers.append((p["interaction_id"], body))
    return Response(status_code=204)


async def edit_original(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    """An interaction's answer edited: what the person sees now."""
    if p["application_id"] != app.id:
        return _error(404, "Unknown Webhook", 10015)
    fake.interaction_edits.append((p["token"], body))
    return JSONResponse({**(body or {}), "id": fake.snowflake()})


async def set_own_nick(
    fake: FakeDiscord, app: FakeApplication, p: dict[str, str], body: Any
) -> Response:
    guild = fake.guilds.get(p["guild_id"])
    if guild is None or app.id not in guild.bots:
        return _error(403, "Missing Access", 50001)
    guild.nicks[app.id] = str((body or {}).get("nick") or "")
    return JSONResponse({"nick": guild.nicks[app.id]})


ROUTES: list[tuple[str, str, Handler]] = [
    ("GET", "/users/@me", users_me),
    ("GET", "/oauth2/applications/@me", application_me),
    ("GET", "/gateway/bot", gateway_bot),
    ("POST", "/channels/{channel_id}/messages", create_message),
    ("GET", "/guilds/{guild_id}", get_guild),
    ("DELETE", "/users/@me/guilds/{guild_id}", leave_guild),
    ("PUT", "/applications/{application_id}/guilds/{guild_id}/commands", put_commands),
    ("POST", "/interactions/{interaction_id}/{token}/callback", answer_interaction),
    ("PATCH", "/webhooks/{application_id}/{token}/messages/@original", edit_original),
    ("PATCH", "/guilds/{guild_id}/members/@me", set_own_nick),
]
_COMPILED = [
    (method, template, re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", template) + "$"), h)
    for method, template, h in ROUTES
]


def _limited(
    fake: FakeDiscord, app_id: str, template: str, params: dict[str, str]
) -> tuple[dict[str, str], Response | None]:
    """Spend one request of the route's bucket; Discord keys a bucket by its route and its major
    parameter (the channel or guild), per token."""
    major = params.get("channel_id") or params.get("guild_id") or ""
    left, reset_after = fake.spend(app_id, template, major)
    bucket = hashlib.sha1(template.encode()).hexdigest()[:16]
    headers = {
        "X-RateLimit-Limit": str(fake.bucket_limit),
        "X-RateLimit-Remaining": str(max(left, 0)),
        "X-RateLimit-Reset-After": f"{reset_after:.3f}",
        "X-RateLimit-Bucket": bucket,
    }
    if left >= 0:
        return headers, None
    body = {"message": "You are being rate limited.", "retry_after": reset_after, "global": False}
    return headers, JSONResponse(
        body, status_code=429, headers={**headers, "X-RateLimit-Scope": "user"}
    )


def _scripted(status: int, global_: bool, retry_after: float) -> Response:
    if status != 429:
        return _error(status, f"scripted {status}", 0)
    headers = {"X-RateLimit-Scope": "global" if global_ else "user"}
    if global_:
        headers["X-RateLimit-Global"] = "true"
    body = {"message": "You are being rate limited.", "retry_after": retry_after, "global": global_}
    return JSONResponse(body, status_code=429, headers=headers)


def rest_app(fake: FakeDiscord) -> Starlette:
    async def endpoint(request: Request) -> Response:
        path = "/" + request.path_params["path"]
        if path == "/oauth2/token" and request.method == "POST":
            response = await oauth.token(fake, request)
            fake.requests.append(FakeRequest(None, "POST", path, None, response.status_code))
            return response
        if request.headers.get("authorization", "").startswith("Bearer "):
            response = await oauth.bearer(fake, request, path)
            fake.requests.append(
                FakeRequest(None, request.method, path, None, response.status_code)
            )
            return response
        raw = await request.body()
        body = json.loads(raw) if raw else None
        auth = request.headers.get("authorization", "")
        app = fake.application_of(auth[4:]) if auth.startswith("Bot ") else None
        response = await _answer(fake, app, request.method, path, body)
        fake.requests.append(
            FakeRequest(app.id if app else None, request.method, path, body, response.status_code)
        )
        return response

    return Starlette(
        routes=[
            Route(
                PREFIX + "/{path:path}",
                endpoint,
                methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            )
        ]
    )


async def _answer(
    fake: FakeDiscord, app: FakeApplication | None, method: str, path: str, body: Any
) -> Response:
    if app is None:
        return _error(401, "401: Unauthorized", 0)
    failure = fake.take_failure(path)
    if failure is not None:
        return _scripted(failure.status, failure.global_, failure.retry_after)
    for route_method, template, pattern, handler in _COMPILED:
        match = pattern.match(path)
        if match is None or route_method != method:
            continue
        headers, refused = _limited(fake, app.id, template, match.groupdict())
        if refused is not None:
            return refused
        response = await handler(fake, app, match.groupdict(), body)
        response.headers.update(headers)
        return response
    return _error(404, "404: Not Found", 0)
