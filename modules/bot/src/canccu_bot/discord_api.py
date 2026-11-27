"""The one-off Discord calls of the connection and the bind (contracts/bot.md): checking an own
application's credentials before they are stored, and the OAuth2 bot install. They run outside
the pool's clients: a token that is being checked has no client yet, and a person's bearer token
never belongs to one. What a client sends for an event goes through its queue instead."""

from __future__ import annotations

from typing import Any

import httpx

from .rest import USER_AGENT

MANAGE_GUILD = 1 << 5
ADMINISTRATOR = 1 << 3


class DiscordRefused(Exception):
    """A check failed; `code` is the contract's error code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class DiscordApi:
    def __init__(self, http: httpx.AsyncClient, api_url: str) -> None:
        self._http = http
        self.api_url = api_url.rstrip("/")

    @property
    def authorize_url(self) -> str:
        """Discord's authorize page sits beside its API: https://discord.com/oauth2/authorize."""
        base = self.api_url.removesuffix("/v10").removesuffix("/api")
        return f"{base}/oauth2/authorize"

    async def _call(
        self, method: str, path: str, *, auth: str, unavailable: str = "discord_unavailable"
    ) -> httpx.Response:
        try:
            response = await self._http.request(
                method,
                self.api_url + path,
                headers={"Authorization": auth, "User-Agent": USER_AGENT},
            )
        except httpx.HTTPError as exc:
            raise DiscordRefused(unavailable) from exc
        if response.status_code >= 500:
            raise DiscordRefused(unavailable)
        return response

    async def check_token(self, token: str, application_id: str) -> None:
        """The token works and belongs to the application (400 `token_invalid`,
        `application_mismatch`)."""
        me = await self._call("GET", "/oauth2/applications/@me", auth=f"Bot {token}")
        if me.status_code == 401:
            raise DiscordRefused("token_invalid")
        if me.status_code != 200:
            raise DiscordRefused("discord_unavailable")
        if str(me.json().get("id")) != application_id:
            raise DiscordRefused("application_mismatch")

    async def _token(self, application_id: str, secret: str, form: dict[str, str]) -> Any:
        try:
            response = await self._http.post(
                self.api_url + "/oauth2/token",
                data=form,
                auth=(application_id, secret),
                headers={"User-Agent": USER_AGENT},
            )
        except httpx.HTTPError as exc:
            raise DiscordRefused("discord_unavailable") from exc
        if response.status_code >= 500:
            raise DiscordRefused("discord_unavailable")
        return response

    async def check_secret(self, application_id: str, secret: str) -> None:
        """A client-credentials token for the application, so a wrong secret fails now and not in
        a later bind (400 `client_secret_invalid`)."""
        form = {"grant_type": "client_credentials", "scope": "identify"}
        response = await self._token(application_id, secret, form)
        if response.status_code != 200:
            raise DiscordRefused("client_secret_invalid")

    async def exchange(
        self, application_id: str, secret: str, code: str, redirect_uri: str
    ) -> dict[str, Any]:
        """The bot install's code for the person's bearer token and the guild Discord added the
        bot to; `code_exchange_failed` for a revoked secret or a used or expired code."""
        form = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri}
        response = await self._token(application_id, secret, form)
        if response.status_code != 200:
            raise DiscordRefused("code_exchange_failed")
        body: dict[str, Any] = response.json()
        return body

    async def person(self, access_token: str) -> tuple[str, list[dict[str, Any]]]:
        """The person's Discord id and their guild list, read with their bearer token."""
        auth = f"Bearer {access_token}"
        me = await self._call("GET", "/users/@me", auth=auth)
        guilds = await self._call("GET", "/users/@me/guilds", auth=auth)
        if me.status_code != 200 or guilds.status_code != 200:
            raise DiscordRefused("code_exchange_failed")
        return str(me.json().get("id")), list(guilds.json())

    async def bot_in_guild(self, token: str, guild_id: str) -> bool:
        response = await self._call("GET", f"/guilds/{guild_id}", auth=f"Bot {token}")
        return response.status_code == 200

    async def as_bot(self, token: str, method: str, path: str, json: Any = None) -> httpx.Response:
        """A platform call outside any event's queue: leaving a guild, writing its commands."""
        try:
            return await self._http.request(
                method,
                self.api_url + path,
                json=json,
                headers={"Authorization": f"Bot {token}", "User-Agent": USER_AGENT},
            )
        except httpx.HTTPError as exc:
            raise DiscordRefused("discord_unavailable") from exc


def manages(guild: dict[str, Any]) -> bool:
    """Owner, Manage Server or Administrator, as the person's own guild list says."""
    try:
        permissions = int(guild.get("permissions") or 0)
    except ValueError:
        return False
    return guild.get("owner") is True or bool(permissions & (MANAGE_GUILD | ADMINISTRATOR))
