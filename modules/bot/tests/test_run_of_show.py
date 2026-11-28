"""The run-of-show posts (L7 of the step 6 plan; contracts/bot.md, Run-of-show posts): an item's
reminder at its shortest lead time and an organiser's announcement, in the `announcements`
channel, once per source event, through the event's own client; and the agenda's events keep the
board true."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest
from canccu_kit import Event
from conftest import NOW, SHARED_ID, Env
from living_world import World, item, raw, world

from canccu_bot import run_of_show
from canccu_bot.rest import RestClient

DOORS = item(
    "Doors open",
    "2026-11-27T10:00:00Z",
    "café and hall",
    kind="doors",
    notify_channels=["screen", "discord_channel", "push"],
)


@dataclass
class HeldClient:
    rest: RestClient
    state: str = "ready"

    @property
    def status(self) -> dict[str, Any]:
        return {"status": self.state, "error_code": None, "since": NOW.isoformat()}


@dataclass
class Room:
    w: World
    channel: str
    client: HeldClient
    seq: int = 0
    held: dict[str, HeldClient] = field(default_factory=dict)

    async def deliver(self, kind: str, data: dict[str, Any], event_id: str | None = None) -> None:
        self.seq += 1
        event = Event(
            event_id or f"a{self.seq}", f"agenda.{kind}", 1, NOW.isoformat(), "agenda", data,
            tenant="ev-a",
        )  # fmt: skip
        await run_of_show.on_agenda(self.w.d, event)

    async def remind(
        self, lead: int = 10, leads: list[int] | None = None, event_id: str | None = None,
        **changes: Any,
    ) -> None:  # fmt: skip
        data = {
            "item": {**DOORS, **changes},
            "lead_minutes": lead,
            "leads_minutes": leads or [30, 10],
        }
        await self.deliver("reminder.triggered", data, event_id)

    @property
    def posts(self) -> list[dict[str, Any]]:
        return self.w.env.discord.messages.get(self.channel, [])


@pytest.fixture
async def room(env: Env) -> Room:
    w = await world(env)
    channel = env.discord.add_channel(w.guild_id, "announcements")
    await env.sql(
        "ev-a",
        "INSERT INTO bot_purposes (purpose, target_id, updated_at)"
        " VALUES ('announcements', $1, $2)",
        channel,
        NOW,
    )
    app = env.discord.applications[SHARED_ID]
    client = HeldClient(RestClient(app.token, http=env.discord.http_client(), api_url=API_URL))
    held = {SHARED_ID: client}
    w.d.held = held.get
    return Room(w, channel, client, held=held)


API_URL = "https://discord.test/api/v10"
KEPT = "SELECT 1 FROM bot_posts WHERE kind = 'run_of_show'"


async def test_a_reminder_posts_at_the_shortest_lead_once(room: Room) -> None:
    await room.remind(lead=30)
    assert room.posts == []
    await room.remind(leads=[30, 10], event_id="r1")
    await room.remind(leads=[30, 10], event_id="r1")
    [post] = room.posts
    assert post["embeds"] == [
        {
            "author": {"name": "Starts in 10 minutes"},
            "title": "Doors open",
            "description": "12:00 · café and hall",
            "color": 0x3366FF,
        }
    ]
    assert post["allowed_mentions"] == {"parse": []}


async def test_a_delayed_items_reminder_posts_again_with_its_new_time(room: Room) -> None:
    await room.remind()
    await room.remind(starts_at="2026-11-27T10:15:00Z")
    assert [p["embeds"][0]["description"] for p in room.posts] == [
        "12:00 · café and hall",
        "12:15 · café and hall",
    ]


@pytest.mark.parametrize(
    "changes",
    [
        {"visibility": "attendees"},
        {"visibility": "crew"},
        {"kind": "quiet_hours"},
        {"notify_channels": ["screen", "push"]},
    ],
)
async def test_only_public_items_chosen_for_the_channel_are_posted(
    room: Room, changes: dict[str, Any]
) -> None:
    await room.remind(**changes)
    await room.deliver("item.announced", {"item": {**DOORS, **changes}, "message": "Now!"})
    assert room.posts == []


async def test_an_announcement_carries_the_message_through_the_guard(room: Room) -> None:
    said = "@everyone come now https://evil.example.net/x or https://a.example.test/agenda/"
    await room.deliver("item.announced", {"item": DOORS, "message": said, "actor_user_id": "u"})
    [post] = room.posts
    embed = post["embeds"][0]
    assert embed["author"] == {"name": "From the crew"}
    assert embed["title"] == "Doors open"
    assert embed["description"].startswith("12:00 · café and hall\n@everyone come now")
    assert "evil.example.net" not in raw(post)
    assert "https://a.example.test/agenda/" in embed["description"]
    assert post["allowed_mentions"] == {"parse": []}


async def test_a_container_without_the_events_client_posts_nothing(room: Room) -> None:
    room.held.clear()
    await room.remind()
    assert room.posts == []
    assert (
        await room.w.env.fetch("ev-a", "SELECT 1 FROM bot_posts WHERE kind = 'run_of_show'") == []
    )


@pytest.mark.parametrize("state", ["paused", "failed", "connecting"])
async def test_a_client_not_ready_posts_nothing_and_keeps_nothing(room: Room, state: str) -> None:
    room.client.state = state
    await room.remind()
    room.client.state = "ready"
    assert room.posts == []
    assert (
        await room.w.env.fetch("ev-a", "SELECT 1 FROM bot_posts WHERE kind = 'run_of_show'") == []
    )


async def test_a_failure_for_now_is_released_for_the_bus(room: Room) -> None:
    room.w.env.discord.fail_next(503, path=f"/channels/{room.channel}/messages", method="POST")
    with pytest.raises(run_of_show.PostFailed):
        await room.remind(leads=[10], event_id="r9")
    await room.remind(leads=[10], event_id="r9")
    assert len(room.posts) == 1


async def test_without_the_announcements_purpose_nothing_is_posted(room: Room) -> None:
    await room.w.env.sql("ev-a", "DELETE FROM bot_purposes WHERE purpose = 'announcements'")
    await room.remind()
    assert room.posts == []


async def test_an_archived_event_posts_nothing(room: Room) -> None:
    room.w.env.contexts["ev-a"]["status"] = "archived"
    await room.remind()
    assert room.posts == []


async def test_the_agendas_events_bring_the_board_up_to_date(room: Room) -> None:
    w = room.w
    await w.editor.tick()
    w.agenda.current = [DOORS]
    await room.deliver("item.started", {"item": DOORS})
    await w.editor.tick()
    [board] = w.board()
    assert "Now · Doors open · café and hall" in board["embeds"][0]["description"]
    assert w.edits(w.board_channel) == 1
