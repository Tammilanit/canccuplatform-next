"""`python -m canccu_bot import-legacy`: the operator's command fails with one clear line, and
exit 1, when a file, the configuration or Postgres is missing, before anything is written."""

from __future__ import annotations

import base64
from pathlib import Path

import pytest
from test_legacy_files import scrubbed

from canccu_bot.__main__ import main

UNREACHABLE = {
    "CANCCU_MODULE": "bot",
    "CANCCU_VERSION": "dev",
    "CANCCU_VALKEY_URL": "redis://127.0.0.1:9",
    "CANCCU_ADMIN_URL": "http://127.0.0.1:9",
    "CANCCU_TENANTS_URL": "http://127.0.0.1:9",
    "CANCCU_DATABASE_URL": "postgresql://bot:pw@127.0.0.1:9/bot_test",
    "CANCCU_SERVICE_KEY": "k" * 40,
    "CANCCU_SECRETS_KEY": "1:" + base64.b64encode(b"s" * 32).decode(),
}


def command(env: Path, state: Path, *extra: str) -> list[str]:
    return ["import-legacy", "--tenant", "ev-a", "--env", str(env), "--state", str(state), *extra]


def test_a_missing_file_is_named(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(command(tmp_path / "none.env", tmp_path, "--dry-run")) == 1
    assert capsys.readouterr().err.strip() == f"error: {tmp_path / 'none.env'} cannot be read"


def test_missing_configuration_is_named(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in UNREACHABLE:
        monkeypatch.delenv(name, raising=False)
    assert main(command(*scrubbed(tmp_path), "--dry-run")) == 1
    assert "missing environment variable(s)" in capsys.readouterr().err


def test_an_unreachable_database_fails_clearly(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    for name, value in UNREACHABLE.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("CANCCU_MIGRATE_DATABASE_URL", raising=False)
    assert main(command(*scrubbed(tmp_path), "--dry-run")) == 1
    err = capsys.readouterr().err
    assert err.startswith("error: cannot reach Postgres")
    assert "placeholder" not in err


def test_without_a_command_it_shows_the_usage(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as stopped:
        main([])
    assert stopped.value.code == 2
    assert "import-legacy" in capsys.readouterr().err
