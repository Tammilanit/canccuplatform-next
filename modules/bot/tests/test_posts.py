"""The announcement post (L3 to L5 of the step 6 plan; mockup 08): one message per announcement
in the guild's `announcements` channel, from `moments.announcement.*`: posted once whatever the
number of containers, edited, marked withdrawn; through the guard, with only an urgent one's
picked role pinged."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

import pytest
from canccu_kit import Event
from conftest import NOW, Env
from test_framework import FakeLook
from test_guild import bound

from canccu_bot import posts
from canccu_bot.deps import Deps
from canccu_bot.guild import unbind

HOST = "a.example.test"
SENT: dict[str, Any] = {
    "id": "a1",
    "level": "info",
    "urgent": False,
    "title": "Match 3 starts at 20:30",
    "body": "Teams to the stage, please.",
    "channels": {"screen": True, "ticker": True, "discord": True, "push": True},
    "zones": [],
    "visibility": "public",
    "item_id": None,
    "sent_at": "2026-11-27T18:14:00Z",
    "expires_at": "2026-11-27T18:19:00Z",
    "actor_user_id": "u_crew",
}


@dataclass
class FakeSettings:
    values: dict[str, Any] = field(default_factory=dict)

    async def ensure(self) -> None:
        return None

    def get(self, key: str, default: Any = None) -> Any:
        return self.values.get(key, default)


@dataclass
class Server:
    env: Env
    d: Deps
    channel: str
    guild_id: str

    async def deliver(
        self, kind: str, data: dict[str, Any], at: str = "2026-11-27T18:14:00Z"
    ) -> None:
        event = Event("e1", f"moments.announcement.{kind}", 1, at, "moments", data, tenant="ev-a")
        await posts.on_moments(self.d, event)

    @property
    def messages(self) -> list[dict[str, Any]]:
        return self.env.discord.messages.get(self.channel, [])


@pytest.fixture
async def server(env: Env) -> Server:
    guild = await bound(env)
    channel = env.discord.add_channel(guild.id, "announcements")
    await env.sql(
        "ev-a",
        "INSERT INTO bot_purposes (purpose, target_id, updated_at)"
        " VALUES ('announcements', $1, $2)",
        channel,
        NOW,
    )
    env.contexts["ev-a"]["primary_hostname"] = HOST
    env.contexts["ev-a"]["time_zone"] = "Europe/Helsinki"
    d = replace(env.deps, look=FakeLook(), settings=FakeSettings())
    return Server(env, d, channel, guild.id)


async def test_a_sent_announcement_is_posted_once_from_the_crew(server: Server) -> None:
    await server.deliver("sent", SENT)
    await server.deliver("sent", SENT)  # again, or by a second container
    [post] = server.messages
    assert post["content"] == ""
    assert post["allowed_mentions"] == {"parse": []}
    assert post["embeds"] == [
        {
            "title": "Match 3 starts at 20:30",
            "description": "Teams to the stage, please.",
            "footer": {"text": "From the crew · on the screens until 20:19"},
            "color": 0x3366FF,
        }
    ]


async def test_the_post_is_edited_and_then_marked_withdrawn(server: Server) -> None:
    await server.deliver("sent", SENT)
    edited = {**SENT, "title": "Match 3 starts at 20:40", "changed": ["title"]}
    await server.deliver("changed", edited, "2026-11-27T18:16:00Z")
    [post] = server.messages
    assert post["embeds"][0]["title"] == "Match 3 starts at 20:40"
    assert post["embeds"][0]["footer"] == {"text": "Updated 20:16 · from the crew"}
    gone = {"id": "a1", "reason": "withdrawn", "why": "", "actor_user_id": "u_crew"}
    await server.deliver("withdrawn", gone, "2026-11-27T18:18:00Z")
    [post] = server.messages
    assert post["embeds"][0]["title"] == "Withdrawn: Match 3 starts at 20:40"
    assert post["embeds"][0]["description"] == "This announcement was withdrawn at 20:18."
    assert post["embeds"][0]["footer"] == {"text": "From the crew"}


async def test_an_urgent_one_pings_only_the_picked_role(server: Server) -> None:
    role = "100000000000008001"
    server.d.settings.values["announce_role"] = role
    urgent = {**SENT, "level": "urgent", "urgent": True}
    urgent["title"] = "@everyone out now https://evil.example.net/x"
    urgent["body"] = f"<@&{role}> @here see www.bad.test and https://{HOST}/notify/"
    await server.deliver("sent", urgent)
    [post] = server.messages
    assert post["content"] == f"<@&{role}>"
    assert post["allowed_mentions"] == {"parse": [], "roles": [role]}
    embed = post["embeds"][0]
    assert "evil.example.net" not in embed["title"] and "bad.test" not in embed["description"]
    assert f"https://{HOST}/notify/" in embed["description"]  # the event's own link stays


@pytest.mark.parametrize("role", ["", "not-a-role", "guild"])
async def test_no_role_or_everyone_pings_nobody(server: Server, role: str) -> None:
    server.d.settings.values["announce_role"] = server.guild_id if role == "guild" else role
    await server.deliver("sent", {**SENT, "level": "urgent", "urgent": True})
    [post] = server.messages
    assert post["content"] == "" and post["allowed_mentions"] == {"parse": []}


async def test_an_info_one_never_pings_the_role(server: Server) -> None:
    server.d.settings.values["announce_role"] = "100000000000008001"
    await server.deliver("sent", SENT)
    assert server.messages[0]["allowed_mentions"] == {"parse": []}


async def test_nothing_is_posted_without_the_channel_or_the_purpose(server: Server) -> None:
    await server.deliver("sent", {**SENT, "channels": {**SENT["channels"], "discord": False}})
    await server.env.sql("ev-a", "DELETE FROM bot_purposes")
    await server.deliver("sent", {**SENT, "id": "a2"})
    assert server.messages == []


async def test_a_failure_for_now_is_released_and_raised_for_the_bus(server: Server) -> None:
    server.env.discord.fail_next(503, path=f"/channels/{server.channel}/messages", method="POST")
    with pytest.raises(posts.PostFailed):
        await server.deliver("sent", SENT)
    await server.deliver("sent", SENT)  # the bus's next try
    assert len(server.messages) == 1


async def test_a_channel_gone_drops_the_post(server: Server) -> None:
    server.env.discord.guilds[server.guild_id].channels.pop(server.channel)
    await server.deliver("sent", SENT)
    assert await server.env.fetch("ev-a", "SELECT 1 FROM bot_posts") == []


async def test_the_posts_go_with_the_binding(server: Server) -> None:
    await server.deliver("sent", SENT)
    await unbind(server.d, "ev-a", "unbound", "u_org")
    assert await server.env.fetch("ev-a", "SELECT 1 FROM bot_posts") == []


async def test_an_archived_event_posts_nothing(server: Server) -> None:
    server.env.contexts["ev-a"]["status"] = "archived"
    await server.deliver("sent", SENT)
    assert server.messages == []
