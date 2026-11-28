"""Matching an activity to the event's games catalogue by the games contract's rule
(contracts/games.md, The catalogue): the application id first, then the name aliases; a hidden
or merged game never matches."""

from __future__ import annotations

from typing import Any

from canccu_bot.catalogue import games_catalogue, match


def entry(gid: str, name: str, apps: list[str], aliases: list[str], status: str = "active") -> Any:
    return {
        "id": gid,
        "name": name,
        "status": status,
        "discord": {"application_ids": apps, "name_aliases": aliases},
    }


GAMES = [
    entry("g1", "Demo Quest", ["700"], ["Demo Quest", "DQ"]),
    entry("g2", "Block Builder", [], ["Block Builder"]),
    entry("g3", "Hidden Game", ["900"], ["Hidden Game"], status="hidden"),
    entry("g4", "Old Copy", ["800"], ["Old Copy"], status="merged"),
]


def test_the_application_id_comes_first() -> None:
    found = match("Something Else", "700", GAMES)
    assert found is not None and found["id"] == "g1"


def test_then_a_name_alias_trimmed_and_without_case() -> None:
    found = match("  dq ", None, GAMES)
    assert found is not None and found["id"] == "g1"
    found = match("block builder", "123", GAMES)
    assert found is not None and found["id"] == "g2"


def test_hidden_and_merged_games_never_match() -> None:
    assert match("Hidden Game", "900", GAMES) is None
    assert match("Old Copy", "800", GAMES) is None


def test_nothing_matches_an_unknown_activity() -> None:
    assert match("Unknown", None, GAMES) is None


async def test_the_seam_answers_the_empty_catalogue_until_the_games_module_serves_it() -> None:
    assert await games_catalogue("ev-a") == []
