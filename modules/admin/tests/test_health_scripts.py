"""The menu's Health note and the Health page's swaps agree (#555): shell.js and health.js run
under node against a stand-in page (tests/js/health_note.mjs)."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).parent
STATIC = HERE.parent / "src/canccu_admin/static"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_note_follows_each_swap_and_reads_one_at_a_time() -> None:
    run = subprocess.run(
        ["node", HERE / "js/health_note.mjs", STATIC / "shell.js", STATIC / "health.js"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert run.returncode == 0, run.stderr
    assert run.stdout.strip() == "ok"
