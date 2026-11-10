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
