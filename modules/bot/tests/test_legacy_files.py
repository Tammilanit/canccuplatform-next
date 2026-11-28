"""Reading the legacy bot's `.env` and state files (#125): what moves, what is dropped and why, and
a clear error, naming the key or the file and never a value, for files that cannot be read."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from canccu_bot.legacy_files import LegacyFileError, parse_env, read

FIXTURE = Path(__file__).parent / "legacy"
IDS = {
    "token": "placeholder.token.value-that-is-long-enough-to-pass-as-a-real-one",
    "guild_id": "100000000000000001",
    "tournaments": "100000000000000003",
    "finals": "100000000000000004",
    "finals_test": "100000000000000005",
    "alerts": "100000000000000006",
}


def scrubbed(tmp_path: Path, **ids: str) -> tuple[Path, Path]:
    """The fixture with its ids filled in, copied so a test may change it."""
    env = tmp_path / "legacy.env"
    env.write_text((FIXTURE / "legacy.env").read_text().format(**{**IDS, **ids}))
    state = tmp_path / "data"
    shutil.copytree(FIXTURE / "data", state)
    return env, state


def test_parse_env_takes_quotes_exports_and_comments() -> None:
    text = "# a comment\n\nexport A=1\nB='two words'\nC=\"x=y\"\nD = 4 \nnot a line\n"
    assert parse_env(text) == {"A": "1", "B": "two words", "C": "x=y", "D": "4"}


def test_what_moves_is_read(tmp_path: Path) -> None:
    legacy = read(*scrubbed(tmp_path))
    assert legacy.token == IDS["token"]
    assert legacy.guild_id == IDS["guild_id"]
    assert legacy.admin_role_name == "Demo Admin"
    assert legacy.channels == {"tournaments": IDS["tournaments"], "crew": IDS["alerts"]}
    assert legacy.settings == {"GAME_THRESHOLD": 4, "BOT_TICKER_TTL_SECONDS": 1800}
    watcher = json.loads((FIXTURE / "data" / "tourney_watcher.json").read_text())
    cards = json.loads((FIXTURE / "data" / "finals_cards.json").read_text())
    assert legacy.finals == {
        "tourney_watcher.json": watcher,
        "finals_cards.json": cards,
        "FINALS_CHANNEL_ID": IDS["finals"],
        "FINALS_TEST_CHANNEL_ID": IDS["finals_test"],
    }


def test_what_stays_behind_is_named_by_key_with_its_reason(tmp_path: Path) -> None:
    legacy = read(*scrubbed(tmp_path))
    skipped = dict(legacy.skipped)
    assert skipped["polls (dropped, 0010)"] == [
        "MAX_POLL_OPTIONS",
        "MIN_POLL_DURATION",
        "POLL_RESULT_DISPLAY_SECONDS",
    ]
    assert skipped["RSS ticker (dropped)"] == ["TICKER_RSS_PORT", "TICKER_RSS_CHANNEL_TITLE"]
    assert "DISCORD_LOGIN_LINK_HMAC_SECRET" in skipped["admin link secret and signage (dropped)"]
    assert skipped["manager URL, tokens and alert users (step 8, alerts)"] == [
        "MANAGER_URL",
        "MANAGER_TOKEN",
        "MANAGER_ALERT_TOKEN",
        "MANAGER_ALERT_DM_USERS",
    ]
    assert "RETENTION_HOURS" in skipped["intervals and retention (the platform's own)"]
    assert skipped["the finals provider's bearer (the operator sets it in Finals, D10)"] == [
        "FINALS_PROVIDER_TOKEN"
    ]
    assert "API_SECRET" in skipped["the signup site and tourney addresses (D9)"]
    assert skipped["in-memory stats, message counts and ticker lines (never on disk)"] == []
    moved = {"DISCORD_TOKEN", "GUILD_ID", "GAME_THRESHOLD", "TOURNAMENT_CHANNEL_ID"}
    assert not moved & {k for keys in skipped.values() for k in keys}
    text = str(legacy.skipped)
    for value in ("placeholder", "example.test", "100000000000000011"):
        assert value not in text


def test_a_missing_token_or_a_bad_id_names_the_key_only(tmp_path: Path) -> None:
    env, state = scrubbed(tmp_path)
    env.write_text("GUILD_ID=100000000000000001\n")
    with pytest.raises(LegacyFileError, match="DISCORD_TOKEN"):
        read(env, state)
    env.write_text("DISCORD_TOKEN=x\nGUILD_ID=not-an-id-secret\n")
    with pytest.raises(LegacyFileError, match="GUILD_ID") as error:
        read(env, state)
    assert "not-an-id-secret" not in str(error.value)
    env.write_text("DISCORD_TOKEN=x\nGUILD_ID=100000000000000001\nGAME_THRESHOLD=many\n")
    with pytest.raises(LegacyFileError, match="GAME_THRESHOLD"):
        read(env, state)


def test_unreadable_files_are_named(tmp_path: Path) -> None:
    env, state = scrubbed(tmp_path)
    with pytest.raises(LegacyFileError, match="nowhere.env"):
        read(tmp_path / "nowhere.env", state)
    with pytest.raises(LegacyFileError, match="not a directory"):
        read(env, tmp_path / "nowhere")
    (state / "finals_cards.json").write_text("{broken")
    with pytest.raises(LegacyFileError, match="finals_cards.json"):
        read(env, state)
    (state / "finals_cards.json").write_text("[1, 2]")
    with pytest.raises(LegacyFileError, match="finals_cards.json"):
        read(env, state)


def test_a_state_file_the_legacy_bot_never_wrote_is_skipped(tmp_path: Path) -> None:
    env, state = scrubbed(tmp_path)
    (state / "finals_cards.json").unlink()
    legacy = read(env, state)
    assert "finals_cards.json" not in legacy.finals
    assert dict(legacy.skipped)["state files the legacy bot never wrote"] == ["finals_cards.json"]


def test_the_state_paths_of_the_env_are_found_in_the_state_directory(tmp_path: Path) -> None:
    env, state = scrubbed(tmp_path)
    (state / "tourney_watcher.json").rename(state / "watcher.json")
    env.write_text(env.read_text() + "TOURNEY_WATCHER_STATE_PATH=data/watcher.json\n")
    legacy = read(env, state)
    assert legacy.finals["tourney_watcher.json"]["champions"] == ["demo-season-1"]
