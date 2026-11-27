"""The shared application comes from the environment, all of it or none (contracts/bot.md)."""

from __future__ import annotations

import pytest
from canccu_kit import ConfigError

from canccu_bot.config import DISCORD_API, discord_config

FULL = {
    "CANCCU_BOT_APPLICATION_ID": "100000000000000002",
    "CANCCU_BOT_TOKEN": "a-token",
    "CANCCU_BOT_CLIENT_SECRET": "a-secret",
}


def test_the_shared_application_is_read_whole() -> None:
    config = discord_config(FULL)
    assert config.shared is not None
    assert (config.shared.application_id, config.shared.token) == ("100000000000000002", "a-token")
    assert config.api_url == DISCORD_API == "https://discord.com/api/v10"


def test_none_of_it_runs_without_a_shared_bot() -> None:
    assert discord_config({}).shared is None


def test_part_of_it_stops_the_start() -> None:
    with pytest.raises(ConfigError, match="CANCCU_BOT_CLIENT_SECRET"):
        discord_config({k: v for k, v in FULL.items() if k != "CANCCU_BOT_CLIENT_SECRET"})


def test_an_application_id_is_a_snowflake() -> None:
    with pytest.raises(ConfigError, match="CANCCU_BOT_APPLICATION_ID"):
        discord_config({**FULL, "CANCCU_BOT_APPLICATION_ID": "demo-bot"})


def test_the_api_can_point_at_the_fake_discord() -> None:
    config = discord_config({**FULL, "CANCCU_DISCORD_API_URL": "http://fake-discord:8080/api/v10/"})
    assert config.api_url == "http://fake-discord:8080/api/v10"
