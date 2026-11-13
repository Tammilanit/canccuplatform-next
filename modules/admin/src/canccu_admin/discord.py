"""Discord OAuth2: the authorize URL, the code exchange and the signed-in Discord user."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
API = "https://discord.com/api/v10"
# `identify` only: no email and no guilds (#52's minimal scopes); role sync is step 3's.
SCOPE = "identify"


class DiscordFailed(Exception):
    """Discord refused the code or did not answer."""


@dataclass(frozen=True)
class DiscordUser:
    id: str
    name: str
    handle: str | None = None


class Discord:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self.client_id = client_id
        self._secret = client_secret
        self.redirect_uri = redirect_uri
        self._http = http or httpx.AsyncClient(timeout=10.0)

    def authorize_url(self, state: str, code_challenge: str) -> str:
        query = urlencode(
            {
                "response_type": "code",
                "client_id": self.client_id,
                "scope": SCOPE,
                "redirect_uri": self.redirect_uri,
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "prompt": "none",
            }
        )
        return f"{AUTHORIZE_URL}?{query}"

    async def user_for_code(self, code: str, verifier: str) -> DiscordUser:
        try:
            token = await self._http.post(
                f"{API}/oauth2/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": self.redirect_uri,
                    "code_verifier": verifier,
                },
                auth=(self.client_id, self._secret),
            )
            if token.status_code != 200:
                raise DiscordFailed(f"token exchange answered {token.status_code}")
            access = token.json()["access_token"]
            me = await self._http.get(
                f"{API}/users/@me", headers={"authorization": f"Bearer {access}"}
            )
            if me.status_code != 200:
                raise DiscordFailed(f"user lookup answered {me.status_code}")
            body = me.json()
            return DiscordUser(
                str(body["id"]),
                str(body.get("global_name") or body["username"]),
                str(body["username"]),
            )
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise DiscordFailed(type(exc).__name__) from exc
