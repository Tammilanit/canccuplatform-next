"""Configuration from the environment."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

ENV_VARS = ("CP_MODULE", "CP_VERSION", "CP_VALKEY_URL", "CP_ADMIN_URL")


class ConfigError(Exception):
    """A required environment variable is missing or empty."""


@dataclass(frozen=True)
class Config:
    module: str
    version: str
    valkey_url: str
    admin_url: str


def load_config(env: Mapping[str, str] | None = None) -> Config:
    """Read the kit settings from the environment; fail naming every missing variable."""
    source = os.environ if env is None else env
    missing = [name for name in ENV_VARS if not source.get(name)]
    if missing:
        raise ConfigError(f"missing environment variable(s): {', '.join(missing)}")
    return Config(
        module=source["CP_MODULE"],
        version=source["CP_VERSION"],
        valkey_url=source["CP_VALKEY_URL"],
        admin_url=source["CP_ADMIN_URL"].rstrip("/"),
    )
