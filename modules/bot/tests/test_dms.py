"""Notify's DMs (D12, E4 of the step 6 plan; contracts/bot.md, Direct messages):
`notify.dm.requested` delivered as a Discord DM through the event's own client and queue, in the
order Notify asked, by the container that holds the client; nothing kept when it cannot send."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest
from canccu_kit import Event
from conftest import API, NOW, SHARED_ID, Env
from test_framework import FakeLook
from test_guild import bound

from canccu_bot.dms import Dms
from canccu_bot.rest import RestClient

HOST = "a.example.test"


@dataclass
class HeldClient:
    rest: Any
    state: str = "ready"

    @property
    def status(self) -> dict[str, Any]:
        return {"status": self.state, "error_code": None, "since": NOW.isoformat()}


@dataclass
class Gated:
    """The client's REST side held shut until the test opens it."""

    rest: RestClient
    gate: asyncio.Event = field(default_factory=asyncio.Event)

    async def request(self, method: str, path: str, **kw: Any) -> Any:
        await self.gate.wait()
        return await self.rest.request(method, path, **kw)


@dataclass
class Mail:
    env: Env
    dms: Dms
    client: HeldClient
    member: str
    other: str
    held: dict[str, HeldClient]
    seq: int = 0

    async def ask(self, user: str, title: str, **more: Any) -> None:
        self.seq += 1
        data = {
            "user_id": "u_1",
            "discord_user_id": user,
            "notification_id": f"n{self.seq}",
            "topic": "food",
            "title": title,
            "body": "Pick it up at the café counter.",
            "url": "/pizza/orders/po_2",
            "urgent": False,
            "reason": "channel",
            **more,
        }
        event = Event(f"d{self.seq}", "notify.dm.requested", 1, NOW.isoformat(), "notify", data,
                      tenant="ev-a")  # fmt: skip
        await self.dms.on_notify(event)

    def got(self, user: str) -> list[str]:
        return [m["embeds"][0]["title"] for m in self.env.discord.dms(user)]


@pytest.fixture
async def mail(env: Env) -> Mail:
    guild = await bound(env)
    member, other = env.discord.add_user("Player One"), env.discord.add_user("Player Two")
    env.discord.add_member(guild.id, member.id)
    env.discord.add_member(guild.id, other.id)
    env.contexts["ev-a"]["primary_hostname"] = HOST
    app = env.discord.applications[SHARED_ID]
    client = HeldClient(RestClient(app.token, http=env.discord.http_client(), api_url=API))
    held = {SHARED_ID: client}
    d = env.deps
    d.look, d.held = FakeLook(), held.get
    return Mail(env, Dms(d), client, member.id, other.id, held)


async def test_a_burst_arrives_in_the_order_notify_asked(mail: Mail) -> None:
    for n in range(30):
        await mail.ask(mail.member if n % 3 else mail.other, f"It's here {n}")
    await mail.dms.settle()
    assert mail.got(mail.member) == [f"It's here {n}" for n in range(30) if n % 3]
    assert mail.got(mail.other) == [f"It's here {n}" for n in range(30) if not n % 3]


async def test_a_dm_is_an_embed_with_a_link_button_to_the_page(mail: Mail) -> None:
    await mail.ask(mail.member, "It's here")
    await mail.dms.settle()
    [dm] = mail.env.discord.dms(mail.member)
    assert dm["embeds"] == [
        {"title": "It's here", "description": "Pick it up at the café counter.", "color": 0x3366FF}
    ]
    button = {"type": 2, "style": 5, "label": "Open", "url": f"https://{HOST}/pizza/orders/po_2"}
    assert dm["components"] == [{"type": 1, "components": [button]}]
    assert dm["allowed_mentions"] == {"parse": []}


async def test_others_words_go_through_the_guard(mail: Mail) -> None:
    await mail.ask(
        mail.member,
        "@everyone https://evil.example.net/a",
        body="see www.bad.test",
        url="https://evil.example.net/b",
    )
    await mail.dms.settle()
    [dm] = mail.env.discord.dms(mail.member)
    assert "evil.example.net" not in str(dm) and "bad.test" not in str(dm)
    assert dm["components"] == [] and dm["allowed_mentions"] == {"parse": []}


async def test_someone_the_bot_cannot_reach_does_not_stop_the_next(mail: Mail) -> None:
    stranger = mail.env.discord.add_user("Stranger").id
    await mail.ask(stranger, "lost")
    await mail.ask(mail.member, "kept")
    await mail.dms.settle()
    assert mail.got(stranger) == [] and mail.got(mail.member) == ["kept"]


async def test_over_the_cap_a_dm_is_dropped_for_that_event(mail: Mail) -> None:
    gated = Gated(mail.client.rest)
    mail.client.rest = gated
    mail.dms = Dms(mail.dms._d, cap=2)
    for n in range(4):
        await mail.ask(mail.member, f"n{n}")
    gated.gate.set()
    await mail.dms.settle()
    assert mail.got(mail.member) == ["n0", "n1"]  # the one in flight counts


@pytest.mark.parametrize("state", ["paused", "failed", "connecting"])
async def test_a_client_not_ready_sends_nothing_and_keeps_nothing(mail: Mail, state: str) -> None:
    mail.client.state = state
    await mail.ask(mail.member, "late")
    mail.client.state = "ready"
    await mail.dms.settle()
    assert mail.got(mail.member) == []


async def test_a_container_without_the_events_client_sends_nothing(mail: Mail) -> None:
    mail.held.clear()
    await mail.ask(mail.member, "elsewhere")
    await mail.dms.settle()
    assert mail.got(mail.member) == []


@pytest.mark.parametrize("user", ["", "not-a-snowflake"])
async def test_a_request_without_a_discord_id_is_dropped(mail: Mail, user: str) -> None:
    await mail.ask(user, "nobody")
    await mail.dms.settle()
    assert mail.env.discord.requests == []


async def test_an_archived_event_sends_nothing(mail: Mail) -> None:
    mail.env.contexts["ev-a"]["status"] = "archived"
    await mail.ask(mail.member, "ended")
    await mail.dms.settle()
    assert mail.got(mail.member) == []
