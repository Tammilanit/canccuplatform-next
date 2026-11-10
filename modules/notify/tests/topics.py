"""Topic registrations as fixtures: `schedule` exactly as contracts/notify.md writes it, and a
personal topic of the shape the contract's table lists (its event names are provisional)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "notify.md"


def schedule() -> dict[str, Any]:
    text = CONTRACT.read_text()
    block = re.search(r"The `schedule` registration in full.*?```json\n(.*?)```", text, re.S)
    assert block is not None
    value: dict[str, Any] = json.loads(block.group(1))
    return value


def play() -> dict[str, Any]:
    return {
        "key": "play",
        "owner": "games",
        "title": "Play",
        "parts": {
            "personal": {
                "scope": "user",
                "channels": ["push", "discord_dm"],
                "defaults": {"push": True, "discord_dm": False},
            }
        },
        "triggers": [
            {
                "event": "games.session.invited",
                "part": "personal",
                "recipients": {"user_field": "data.user_ids"},
                "title": "{data.game} with {data.host}",
                "body": "Starts at {data.at|time}",
                "url": "/notify/games",
            }
        ],
    }


def reminder(visibility: str = "public", lead: int = 10, **item: Any) -> dict[str, Any]:
    """`agenda.reminder.triggered` data, as contracts/agenda.md describes it."""
    return {
        "item": {
            "id": "it1",
            "title": "Dinner",
            "kind": "meal",
            "starts_at": "2026-11-20T18:00:00Z",
            "visibility": visibility,
            "notify_channels": ["push", "discord_dm"],
            **item,
        },
        "lead_minutes": lead,
        "leads_minutes": [lead],
    }


def alert() -> dict[str, Any]:
    """An event-wide topic whose trigger may be urgent, for the cap (no module registers it)."""
    return {
        "key": "alert",
        "owner": "admin",
        "title": "Alerts",
        "parts": {
            "event": {
                "scope": "event",
                "channels": ["push", "discord_dm"],
                "defaults": {"push": True, "discord_dm": False},
            }
        },
        "triggers": [
            {
                "event": "admin.alert.raised",
                "part": "event",
                "audience": {"field": "data.visibility"},
                "urgent": {"field": "data.urgent"},
                "title": "{data.title}",
                "body": "Alert",
                "expires_after_minutes": 30,
            }
        ],
    }


def game() -> dict[str, Any]:
    """The contract's `game` topic: followers of `data.game.id` among current members. Its
    `removed` event is provisional (the games contract has none yet)."""
    return {
        "key": "game",
        "owner": "games",
        "title": "Games you follow",
        "parts": {
            "personal": {
                "scope": "entity",
                "channels": ["push", "discord_dm"],
                "defaults": {"push": True, "discord_dm": False},
                "entity": {
                    "type": "game",
                    "merged": {
                        "event": "games.game.merged",
                        "from": "data.game_id",
                        "into": "data.into_game_id",
                    },
                    "removed": {"event": "games.game.removed", "id": "data.game_id"},
                },
            }
        },
        "triggers": [
            {
                "event": "games.surge.started",
                "part": "personal",
                "audience": {"value": "attendees"},
                "recipients": {"entity_field": "data.game.id"},
                "title": "{data.game.name} is popular now",
                "body": "{data.players} are playing",
                "expires_after_minutes": 60,
            }
        ],
    }


def surge(game_id: str = "g_1") -> dict[str, Any]:
    game = {"id": game_id, "name": "Chess", "cover_url": None}
    return {"game": game, "players": 8, "threshold": 6}


def quiet(item_id: str = "q1", start: int = -10, end: int = 20, **item: Any) -> dict[str, Any]:
    """A `quiet_hours` item, `start` and `end` in minutes from the tests' NOW."""
    from conftest import at

    return {
        "id": item_id,
        "title": "Night",
        "kind": "quiet_hours",
        "starts_at": at(start),
        "ends_at": at(end),
        "visibility": "public",
        "status": "scheduled",
        **item,
    }
