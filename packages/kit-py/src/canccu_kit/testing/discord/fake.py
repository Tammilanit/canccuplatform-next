"""`FakeDiscord`: the state a test sets up, its REST app and its gateway."""

from __future__ import annotations

import itertools
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from .gateway import FakeGateway
from .model import FakeApplication, FakeGuild, FakeRequest, Intents, ScriptedFailure


@dataclass
class _Window:
    started: float
    used: int


class FakeDiscord:
    """Discord's REST API v10 and gateway, as far as the bot uses them, with the rate limits and
    failures a bot must survive. Ids are snowflake-shaped placeholders, never real ones."""

    def __init__(
        self,
        *,
        gateway_url: str = "ws://fake-discord.test/gateway",
        bucket_limit: int = 50,
        bucket_window_s: float = 1.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.gateway_url = gateway_url
        self.bucket_limit = bucket_limit
        self.bucket_window_s = bucket_window_s
        self.clock = clock
        self.applications: dict[str, FakeApplication] = {}
        self.guilds: dict[str, FakeGuild] = {}
        self.messages: dict[str, list[dict[str, Any]]] = {}
        self.requests: list[FakeRequest] = []
        self.failures: list[ScriptedFailure] = []
        self._windows: dict[tuple[str, str, str], _Window] = {}
        self._ids = itertools.count(100000000000000100)
        self.gateway = FakeGateway(lambda: self.applications, lambda: self.guilds, gateway_url)

    def snowflake(self) -> str:
        return str(next(self._ids))

    def add_application(
        self,
        name: str,
        *,
        id: str | None = None,
        token: str | None = None,
        client_secret: str | None = None,
        privileged: int = Intents.PRIVILEGED,
    ) -> FakeApplication:
        app_id = id or self.snowflake()
        app = FakeApplication(
            id=app_id,
            name=name,
            # As long as a real token, so a length check treats it as one.
            token=token or f"fake.{app_id}.{secrets.token_urlsafe(32)}",
            client_secret=client_secret or secrets.token_urlsafe(24),
            bot_user_id=self.snowflake(),
            privileged=privileged,
        )
        self.applications[app.id] = app
        return app

    def add_guild(self, name: str, *, bots: list[str] | None = None) -> FakeGuild:
        guild_id = self.snowflake()
        everyone = {"id": guild_id, "name": "@everyone", "position": 0, "permissions": "0"}
        guild = FakeGuild(
            guild_id, name, self.snowflake(), set(bots or []), roles={guild_id: everyone}
        )
        self.guilds[guild.id] = guild
        return guild

    def add_channel(self, guild_id: str, name: str, *, type: int = 0) -> str:
        channel_id = self.snowflake()
        self.guilds[guild_id].channels[channel_id] = {
            "id": channel_id,
            "guild_id": guild_id,
            "name": name,
            "type": type,
        }
        return channel_id

    def fail_next(
        self,
        status: int,
        *,
        path: str | None = None,
        global_: bool = False,
        retry_after: float = 1.0,
        times: int = 1,
    ) -> None:
        """Answer the next `times` requests (to `path` only, when given) with `status`."""
        self.failures.append(ScriptedFailure(status, path, global_, retry_after, times))

    def application_of(self, token: str) -> FakeApplication | None:
        return next((a for a in self.applications.values() if a.token == token), None)

    def channel(self, channel_id: str) -> tuple[FakeGuild, dict[str, Any]] | None:
        for guild in self.guilds.values():
            if channel_id in guild.channels:
                return guild, guild.channels[channel_id]
        return None

    def take_failure(self, path: str) -> ScriptedFailure | None:
        for failure in self.failures:
            if failure.path is None or failure.path == path:
                failure.times -= 1
                if failure.times <= 0:
                    self.failures.remove(failure)
                return failure
        return None

    def spend(self, app_id: str, route: str, major: str) -> tuple[int, float]:
        """One request against a bucket: the requests left after it (-1 when none was left) and
        the seconds until the bucket resets."""
        now = self.clock()
        window = self._windows.get((app_id, route, major))
        if window is None or now - window.started >= self.bucket_window_s:
            window = self._windows[(app_id, route, major)] = _Window(now, 0)
        reset_after = max(0.0, self.bucket_window_s - (now - window.started))
        if window.used >= self.bucket_limit:
            return -1, reset_after
        window.used += 1
        return self.bucket_limit - window.used, reset_after

    def rest_app(self) -> Any:
        from .rest import rest_app  # starlette is the kit's optional extra

        return rest_app(self)

    def http_client(self) -> httpx.AsyncClient:
        """A client whose every request this fake answers, whatever the host."""
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=self.rest_app()))
