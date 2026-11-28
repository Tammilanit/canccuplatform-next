"""Players per "playing" activity: a port of the legacy `game_detector`'s count, which grouped
members' playing activities by their cleaned name and took the application id most of them
carried. The legacy title-cased the name ("Osu!"); here the group's key ignores case and spacing
and the spelling most players carry is shown. Who plays is kept only as a Discord id in the live
state; the counts name nobody (D7). Matching to the games catalogue is the games module's for
surges (contracts/games.md, Surges) and `catalogue.py`'s for the stats."""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from .presence_tracker import is_bot, user_id
from .tracked import Tracked

PLAYING = 0
NAME_MAX = 128


def clean(name: str) -> str:
    return " ".join(name.split())[:NAME_MAX]


def majority(values: list[Any]) -> Any:
    return Counter(values).most_common(1)[0][0] if values else None


class ActivityTracker:
    def __init__(self) -> None:
        self.playing = Tracked()
        """Discord id → JSON list of `[application_id or null, name]`."""

    def slices(self) -> dict[str, Tracked]:
        return {"playing": self.playing}

    def guild(self, data: dict[str, Any]) -> None:
        if "presences" in data:
            self.playing.clear()
            for p in data["presences"]:
                self.presence(p)

    def presence(self, data: dict[str, Any]) -> None:
        uid = user_id(data)
        if uid is None:
            return
        games = []
        if data.get("status") not in (None, "offline") and not is_bot(data):
            for a in data.get("activities") or []:
                name = clean(str(a.get("name") or ""))
                if a.get("type") == PLAYING and name:
                    app = a.get("application_id")
                    games.append([None if app is None else str(app), name])
        if games:
            self.playing.set(uid, json.dumps(games))
        else:
            self.playing.drop(uid)

    def count(self, hidden: frozenset[str], bots: frozenset[str]) -> list[dict[str, Any]]:
        groups: dict[str, dict[str, list[Any]]] = {}
        for uid, raw in self.playing.values.items():
            if uid in hidden or uid in bots:
                continue
            for app, name in json.loads(raw):
                group = groups.setdefault(name.casefold(), {"apps": [], "names": []})
                group["names"].append(name)
                if app is not None:
                    group["apps"].append(app)
        out = [
            {
                "application_id": majority(g["apps"]),
                "name": majority(g["names"]),
                "players": len(g["names"]),
            }
            for g in groups.values()
        ]
        out.sort(key=lambda a: (-a["players"], a["name"]))
        return out
