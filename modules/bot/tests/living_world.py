"""A bound guild with the now-and-next and food channels, the pizza and agenda events, a clock the
test moves, and the editor of the event's client (#852): shared by the living messages' tests and
their transcripts."""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any

from canccu_kit import Event
from conftest import API, NOW, SHARED_ID, Env
from test_framework import FakeLook
from test_guild import bound

from canccu_bot import food
from canccu_bot.deps import Deps
from canccu_bot.living import Editor
from canccu_bot.rest import RestClient
from canccu_bot.router import Directory

HOST = "a.example.test"
HOLDER_DISCORD_ID = "100000000000000777"


def order(**changes: Any) -> dict[str, Any]:
    """Order 2 at Demo Trattoria, open until 12:30 in Helsinki, 3 pizzas, Player Two holds it."""
    base: dict[str, Any] = {
        "id": "po_2",
        "seq": 2,
        "state": "open",
        "pizzeria": {"id": "pz_2", "name": "Demo Trattoria"},
        "target_at": "2026-11-27T10:30:00Z",
        "closes_at": "2026-11-27T10:30:00Z",
        "holder": {"user_id": "u_2", "discord_user_id": HOLDER_DISCORD_ID, "name": "Player Two"},
        "pizza_count": 3,
        "people_count": 3,
        "opened_at": "2026-11-27T09:41:00Z",
        "closed_at": None,
        "placed_at": None,
        "arrived_at": None,
        "estimate_at": None,
        "pickup": None,
        "done_at": None,
        "revision": 1,
    }
    return {**base, **changes}


@dataclass
class Clock:
    at: datetime = NOW

    def __call__(self) -> datetime:
        return self.at

    def move(self, seconds: float) -> None:
        self.at += timedelta(seconds=seconds)


@dataclass
class FakeAgenda:
    current: list[dict[str, Any]] = field(default_factory=list)
    next: list[dict[str, Any]] = field(default_factory=list)
    down: bool = False

    async def now(self, tenant: str) -> dict[str, Any] | None:
        if self.down:
            return None
        now = {"time": NOW.isoformat(), "agenda_version": 1}
        return {**now, "current": self.current, "next": self.next}


def item(title: str, starts_at: str, location: str | None = None, **more: Any) -> dict[str, Any]:
    return {
        "id": f"it_{title.lower().replace(' ', '_')}",
        "title": title,
        "kind": "activity",
        "starts_at": starts_at,
        "ends_at": None,
        "location": location,
        "visibility": "public",
        **more,
    }


@dataclass
class World:
    env: Env
    d: Deps
    editor: Editor
    guild_id: str
    board_channel: str
    food_channel: str
    clock: Clock
    agenda: FakeAgenda
    seq: int = 0

    async def pizza(self, kind: str, data: dict[str, Any]) -> None:
        self.seq += 1
        at = self.clock().isoformat()
        event = Event(f"p{self.seq}", f"pizza.{kind}", 1, at, "pizza", data, tenant="ev-a")
        await food.on_pizza(self.d, event)

    async def order_event(self, kind: str, **changes: Any) -> None:
        await self.pizza(f"order.{kind}", {"order": order(**changes), "actor_user_id": "u_2"})

    def board(self) -> list[dict[str, Any]]:
        return self.env.discord.messages.get(self.board_channel, [])

    def food(self) -> list[dict[str, Any]]:
        return self.env.discord.messages.get(self.food_channel, [])

    def pinned(self) -> list[str]:
        return self.env.discord.pins.get(self.board_channel, [])

    def edits(self, channel: str) -> int:
        return sum(
            1
            for r in self.env.discord.requests
            if r.method == "PATCH" and r.path.startswith(f"/channels/{channel}/messages/")
        )


def text(message: dict[str, Any]) -> str:
    """What a reader sees of an embed: title, lines and footer."""
    embed = message["embeds"][0]
    footer = (embed.get("footer") or {}).get("text", "")
    return "\n".join(p for p in (embed.get("title", ""), embed.get("description", ""), footer) if p)


def raw(message: dict[str, Any]) -> str:
    return json.dumps(message)


async def world(env: Env) -> World:
    guild = await bound(env)
    board = env.discord.add_channel(guild.id, "now-and-next")
    food_channel = env.discord.add_channel(guild.id, "food")
    for purpose, channel in (("now_and_next", board), ("food", food_channel)):
        await env.sql(
            "ev-a",
            "INSERT INTO bot_purposes (purpose, target_id, updated_at) VALUES ($1, $2, $3)",
            purpose,
            channel,
            NOW,
        )
    ctx = env.contexts["ev-a"]
    ctx["primary_hostname"] = HOST
    ctx["time_zone"] = "Europe/Helsinki"
    ctx["flags"] = {"pizza.enabled": True}
    clock, agenda = Clock(), FakeAgenda()
    d = replace(env.deps, look=FakeLook(), agenda=agenda, now=clock)
    editor = Editor(d, SHARED_ID, Directory(d))
    app = env.discord.applications[SHARED_ID]
    editor.rest = RestClient(app.token, http=env.discord.http_client(), api_url=API)
    editor.ready = lambda: True
    return World(env, d, editor, guild.id, board, food_channel, clock, agenda)
