"""The legacy bot's files, read for its one-time import (#125; D9, D10 of the step 6 plan): its
`.env` and the two JSON state files, never written to. What moves is picked out; every other key
is grouped under why it stays behind. Errors name the key or the file, never a value: the `.env`
holds secrets (docs/legacy-inventory/canccubot.md, Configuration)."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path, PurePath
from typing import Any

SNOWFLAKE = re.compile(r"^[0-9]{17,20}$")
LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$")

CHANNELS = {"TOURNAMENT_CHANNEL_ID": "tournaments", "MANAGER_ALERT_CHANNEL_ID": "crew"}
"""Legacy channel → purpose (contracts/bot.md, Purposes). The alert channel was the admins' own
channel, which is what `crew` is."""
FINALS_CHANNELS = ("FINALS_CHANNEL_ID", "FINALS_TEST_CHANNEL_ID")
"""No purpose takes them: the Finals track owns its posts (P8), so they stay with the finals
state for the Finals module."""
SETTINGS = ("GAME_THRESHOLD", "BOT_TICKER_TTL_SECONDS")
STATE_FILES = {
    "tourney_watcher.json": "TOURNEY_WATCHER_STATE_PATH",
    "finals_cards.json": "FINALS_CARD_STATE_PATH",
}
MOVED = {"DISCORD_TOKEN", "GUILD_ID", "ADMIN_ROLE_NAME", *CHANNELS, *FINALS_CHANNELS, *SETTINGS}
MOVED |= set(STATE_FILES.values())

LEGACY_ADMIN_ROLE = "LAN Admin"
"""The role name the legacy bot used when ADMIN_ROLE_NAME was unset."""
NEVER_ON_DISK = "in-memory stats, message counts and ticker lines (never on disk)"
NEVER_WRITTEN = "state files the legacy bot never wrote"


def _starts(*prefixes: str) -> Callable[[str], bool]:
    return lambda key: key.startswith(prefixes)


def _ends(*suffixes: str) -> Callable[[str], bool]:
    return lambda key: key.endswith(suffixes)


# First match wins, so the narrower groups come first (the finals bearer before the tourney's
# addresses, the manager before the intervals).
SKIPS: tuple[tuple[str, Callable[[str], bool]], ...] = (
    ("polls (dropped, 0010)", _starts("POLL_", "MAX_POLL_", "MIN_POLL_")),
    ("RSS ticker (dropped)", _starts("TICKER_RSS_")),
    (
        "admin link secret and signage (dropped)",
        _starts("DISCORD_LOGIN_LINK_", "SIGNAGE_", "CANCCUSIGNAGE_", "LAN_DISPLAY_"),
    ),
    ("manager URL, tokens and alert users (step 8, alerts)", _starts("MANAGER_")),
    (
        "the finals provider's bearer (the operator sets it in Finals, D10)",
        lambda key: key == "FINALS_PROVIDER_TOKEN",
    ),
    (
        "the signup site and tourney addresses (D9)",
        _starts("API_", "FRONTEND_", "TOURNEY_", "ADMIN_TOKEN", "INTEGRATION_"),
    ),
    ("feature switches (the event's flags)", _ends("_ENABLED", "_TEST_MODE")),
    (
        "intervals and retention (the platform's own)",
        _ends("_INTERVAL", "_SECONDS", "_MIN", "_MINUTES", "_HOURS", "_DAYS", "_DURATION"),
    ),
    (
        "logging, health, version and time zone (the platform's own)",
        _starts("LOG_", "HEALTH_", "BOT_VERSION", "EVENT_"),
    ),
)
OTHER = "other keys the import does not move (D10)"


class LegacyFileError(Exception):
    """A file that cannot be read as the legacy bot wrote it."""


@dataclass(frozen=True)
class Legacy:
    token: str
    guild_id: str
    admin_role_name: str
    channels: dict[str, str]
    """Purpose → channel id."""
    settings: dict[str, int]
    """Legacy key → value, only the keys the `.env` sets."""
    finals: dict[str, Any]
    """Legacy name (a state file or a channel's key) → what it held."""
    skipped: list[tuple[str, list[str]]] = field(default_factory=list)
    """Why → the legacy keys or files it covers, in the report's order."""


def parse_env(text: str) -> dict[str, str]:
    """A dotenv file as python-dotenv reads the legacy one: `KEY=value`, an optional `export`,
    one pair of quotes around a value; blank lines, comments and anything else are ignored."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        if line.lstrip().startswith("#"):
            continue
        match = LINE.match(line)
        if match is None:
            continue
        key, value = match.groups()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        out[key] = value
    return out


def _snowflake(env: dict[str, str], key: str) -> str | None:
    value = env.get(key, "")
    if not value:
        return None
    if not SNOWFLAKE.fullmatch(value):
        raise LegacyFileError(f"{key} is not a Discord id")
    return value


def _settings(env: dict[str, str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for key in SETTINGS:
        if env.get(key):
            try:
                out[key] = int(env[key])
            except ValueError:
                raise LegacyFileError(f"{key} is not a whole number") from None
    return out


def _state(env: dict[str, str], state_dir: Path) -> tuple[dict[str, Any], list[str]]:
    """Each state file by its default name, or by the base name its env key gives, from the state
    directory the operator copied (the legacy paths are relative to the legacy install)."""
    if not state_dir.is_dir():
        raise LegacyFileError(f"{state_dir} is not a directory")
    found: dict[str, Any] = {}
    missing: list[str] = []
    for name, key in STATE_FILES.items():
        path = state_dir / PurePath(env.get(key) or name).name
        if not path.is_file():
            missing.append(name)
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            raise LegacyFileError(f"{path.name} is not readable JSON") from None
        if not isinstance(value, dict):
            raise LegacyFileError(f"{path.name} is not a JSON object")
        found[name] = value
    return found, missing


def _skipped(env: dict[str, str], missing: list[str]) -> list[tuple[str, list[str]]]:
    groups: dict[str, list[str]] = {}
    for key in env:
        if key in MOVED:
            continue
        reason = next((why for why, match in SKIPS if match(key)), OTHER)
        groups.setdefault(reason, []).append(key)
    order = [why for why, _ in SKIPS] + [OTHER]
    out = [(why, groups[why]) for why in order if why in groups]
    if missing:
        out.append((NEVER_WRITTEN, missing))
    out.append((NEVER_ON_DISK, []))
    return out


def read(env_path: Path, state_dir: Path) -> Legacy:
    try:
        env = parse_env(env_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        raise LegacyFileError(f"{env_path} cannot be read") from None
    token = env.get("DISCORD_TOKEN", "")
    if not token:
        raise LegacyFileError("DISCORD_TOKEN is not set")
    guild = _snowflake(env, "GUILD_ID")
    if guild is None:
        raise LegacyFileError("GUILD_ID is not set")
    channels = {p: c for key, p in CHANNELS.items() if (c := _snowflake(env, key)) is not None}
    finals, missing = _state(env, state_dir)
    for key in FINALS_CHANNELS:
        channel = _snowflake(env, key)
        if channel is not None:
            finals[key] = channel
    return Legacy(
        token=token,
        guild_id=guild,
        admin_role_name=env.get("ADMIN_ROLE_NAME") or LEGACY_ADMIN_ROLE,
        channels=channels,
        settings=_settings(env),
        finals=finals,
        skipped=_skipped(env, missing),
    )
