"""The tournament fixtures match the event catalog (contracts/events.md, Tournament), so the
mirror is tested against the shapes the tournament module will emit (plan issue-187 D7)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

CATALOG = Path(__file__).resolve().parents[3] / "contracts" / "events.md"
FIXTURES = sorted((Path(__file__).parent / "fixtures" / "tournament").glob("*.json"))
TICKS = re.compile(r"`([a-z_]+)`")


def _strip_parens(text: str) -> str:
    """Drop parenthesised notes, nested ones too: `session` (Session) names one field."""
    while True:
        stripped = re.sub(r"\([^()]*\)", "", text)
        if stripped == text:
            return text
        text = stripped


def _shape(catalog: str, name: str) -> set[str]:
    """The field names of a shape's table (`A **Session**:`, `A person … **Person**:`)."""
    start = catalog.index(f"**{name}**:")
    fields: set[str] = set()
    for line in catalog[start:].splitlines()[1:]:
        if fields and not line.startswith("|"):
            break
        if line.startswith("| `"):
            fields.update(TICKS.findall(line.split("|")[1]))
    return fields


def _data_fields(catalog: str, event_type: str) -> set[str]:
    for line in catalog.splitlines():
        if line.startswith(f"| `{event_type}` |"):
            return set(TICKS.findall(_strip_parens(line.split("|")[-2])))
    raise AssertionError(f"{event_type} is not in the catalog")


@pytest.fixture(scope="module")
def catalog() -> str:
    return CATALOG.read_text()


def test_there_is_a_fixture_per_session_event() -> None:
    assert [f.name for f in FIXTURES] == [
        "session.added.json",
        "session.cancelled.json",
        "session.changed.json",
        "session.removed.json",
    ]


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.name)
def test_each_fixture_has_the_catalogs_fields(catalog: str, path: Path) -> None:
    event: dict[str, Any] = json.loads(path.read_text())
    assert event["source"] == "tournament" and event["version"] == 1
    assert set(event["data"]) == _data_fields(catalog, event["type"])
    if "session" in event["data"]:
        assert set(event["data"]["session"]) == _shape(catalog, "Session")
        assert set(event["data"]["session"]["game"]) == {"id", "name"}
    for person in event["data"].get("people", []):
        assert set(person) == _shape(catalog, "Person")


def test_the_parser_reads_the_catalog(catalog: str) -> None:
    session = _shape(catalog, "Session")
    assert {"id", "starts_at", "registration_closes_at", "ends_at", "revision"} <= session
    assert _data_fields(catalog, "tournament.session.cancelled") == {
        "session",
        "user_ids",
        "people",
        "actor_user_id",
    }
