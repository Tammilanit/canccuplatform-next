"""The fake's OAuth2 side: `POST /oauth2/token` (client credentials and the code exchange of a
bot install) and a person's own reads with the bearer token it gives."""

from __future__ import annotations

import base64
import secrets
from typing import TYPE_CHECKING
from urllib.parse import parse_qs

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .model import FakeApplication, FakeGrant

if TYPE_CHECKING:
    from .fake import FakeDiscord


def _refused(status: int, error: str) -> JSONResponse:
    return JSONResponse({"error": error}, status_code=status)


def _client(fake: FakeDiscord, request: Request, form: dict[str, str]) -> FakeApplication | None:
    """Discord takes the client's id and secret as HTTP Basic or in the form."""
    app_id, secret = form.get("client_id", ""), form.get("client_secret", "")
    auth = request.headers.get("authorization", "")
    if auth.startswith("Basic "):
        try:
            app_id, _, secret = base64.b64decode(auth[6:]).decode().partition(":")
        except ValueError:
            return None
    app = fake.applications.get(app_id)
    if app is None or not secrets.compare_digest(app.client_secret, secret):
        return None
    return app


async def token(fake: FakeDiscord, request: Request) -> Response:
    raw = (await request.body()).decode()
    form = {k: v[0] for k, v in parse_qs(raw).items()}
    app = _client(fake, request, form)
    if app is None:
        return _refused(401, "invalid_client")
    grant = form.get("grant_type")
    if grant == "client_credentials":
        access = secrets.token_urlsafe(24)
        return JSONResponse(
            {
                "access_token": access,
                "token_type": "Bearer",
                "expires_in": 604800,
                "scope": "identify",
            }
        )
    if grant != "authorization_code" or not form.get("redirect_uri"):
        return _refused(400, "unsupported_grant_type")
    found = fake.codes.pop(form.get("code", ""), None)
    if found is None or found.application_id != app.id:
        return _refused(400, "invalid_grant")
    access = secrets.token_urlsafe(24)
    fake.bearers[access] = found
    body: dict[str, object] = {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": 604800,
        "scope": "bot applications.commands identify guilds",
    }
    if found.guild_id is not None:
        guild = fake.guilds[found.guild_id]
        body["guild"] = {"id": guild.id, "name": guild.name, "owner_id": guild.owner_id}
    return JSONResponse(body)


def _guild_entry(fake: FakeDiscord, grant: FakeGrant, guild_id: str) -> dict[str, object]:
    guild = fake.guilds[guild_id]
    member = guild.members.get(grant.user_id) or {}
    return {
        "id": guild.id,
        "name": guild.name,
        "owner": guild.owner_id == grant.user_id,
        "permissions": str(member.get("permissions", "0")),
    }


async def bearer(fake: FakeDiscord, request: Request, path: str) -> Response:
    """`GET /users/@me` and `/users/@me/guilds` for the person behind a bearer token."""
    auth = request.headers.get("authorization", "")
    grant = fake.bearers.get(auth[7:]) if auth.startswith("Bearer ") else None
    if grant is None:
        return JSONResponse({"message": "401: Unauthorized", "code": 0}, status_code=401)
    user = fake.users[grant.user_id]
    if request.method == "GET" and path == "/users/@me":
        return JSONResponse({"id": user.id, "username": user.username})
    if request.method == "GET" and path == "/users/@me/guilds":
        theirs = [
            g.id for g in fake.guilds.values() if g.owner_id == user.id or user.id in g.members
        ]
        return JSONResponse([_guild_entry(fake, grant, g) for g in theirs])
    return JSONResponse({"message": "404: Not Found", "code": 0}, status_code=404)
