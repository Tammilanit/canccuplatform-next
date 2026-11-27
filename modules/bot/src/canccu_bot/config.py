"""The shared application and the Discord API, from the environment (contracts/bot.md, The client
pool): never from the database."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from canccu_kit import ConfigError, KitError
from canccu_kit.resolve import normalize_host
from starlette.requests import Request

DISCORD_API = "https://discord.com/api/v10"
SHARED_VARS = ("CANCCU_BOT_APPLICATION_ID", "CANCCU_BOT_TOKEN", "CANCCU_BOT_CLIENT_SECRET")


@dataclass(frozen=True)
class SharedApp:
    application_id: str
    token: str
    client_secret: str

    def __repr__(self) -> str:  # never the credentials in a log line
        return f"SharedApp({self.application_id})"


@dataclass(frozen=True)
class DiscordConfig:
    shared: SharedApp | None
    """None: this install runs no shared bot; its events can still bring their own."""
    api_url: str


def discord_config(env: Mapping[str, str]) -> DiscordConfig:
    """All three shared variables or none: a half-set shared bot would fail later and quietly."""
    present = [n for n in SHARED_VARS if env.get(n)]
    if present and len(present) < len(SHARED_VARS):
        missing = ", ".join(n for n in SHARED_VARS if n not in present)
        raise ConfigError(f"the shared bot needs {missing} too")
    shared = None
    if present:
        app_id = env["CANCCU_BOT_APPLICATION_ID"]
        if not (app_id.isdigit() and 15 <= len(app_id) <= 20):
            raise ConfigError("CANCCU_BOT_APPLICATION_ID is not a Discord application id")
        shared = SharedApp(app_id, env["CANCCU_BOT_TOKEN"], env["CANCCU_BOT_CLIENT_SECRET"])
    # The CI stack points it at the fake Discord (deploy/compose.ci.yml).
    api_url = (env.get("CANCCU_DISCORD_API_URL") or DISCORD_API).rstrip("/")
    return DiscordConfig(shared, api_url)


@dataclass(frozen=True)
class Hosts:
    """The platform's own hostnames, from the environment, never from a request."""

    signin: str | None
    superadmin: str | None
    public_url: str | None
    """`CANCCU_PUBLIC_URL`: admin's public origin, the one host in IP mode."""

    def callback_origin(self) -> str | None:
        """Seam: the install callback is on the central sign-in host (#52); until a stack has
        one, on admin's public origin, where the IP-mode stack serves everything."""
        if self.signin:
            return f"https://{self.signin}"
        return self.public_url.rstrip("/") if self.public_url else None

    def callback_uri(self) -> str | None:
        origin = self.callback_origin()
        return None if origin is None else f"{origin}/api/bot/install/callback"

    def event_url(self, hostname: str, path: str) -> str:
        """A page on an event's own hostname: https, or the public origin's scheme on a stack
        that serves plain http."""
        scheme = urlsplit(self.public_url).scheme if self.public_url else "https"
        return f"{scheme}://{hostname}{path}"

    def is_callback_host(self, request: Request) -> bool:
        origin = self.callback_origin()
        if origin is None:
            return False
        return normalize_host(urlsplit(origin).hostname) == normalize_host(request.url.hostname)

    def require_superadmin_host(self, request: Request) -> None:
        """Superadmin paths exist only on the superadmin hostname: 404 elsewhere."""
        host = normalize_host(request.url.hostname)
        if self.superadmin is None or host != normalize_host(self.superadmin):
            raise KitError("not found", status=404, code="not_found")
