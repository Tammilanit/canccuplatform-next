"""The event's voice in Discord (L6, L8): the bot's nickname in the server is the event's name,
set after a bind and when the name changes, and its embeds take the event's colour."""

from __future__ import annotations

from dataclasses import replace

import httpx
from canccu_kit import SERVICE_HEADER, ServiceIdentity
from canccu_kit.testing import tenant_event
from conftest import SHARED_ID, Env
from test_bind import bind, organiser
from test_guild import bound

from canccu_bot.lifecycle import on_tenant
from canccu_bot.look import EventLook, Look, set_nickname
from canccu_bot.router import Directory

KEY = b"bot-tests-service-key-0123456789abcdef"
HOST = "a.example.test"


class Outside:
    def __init__(self) -> None:
        self.name = "Demo Event"
        self.color: object = 0x3366FF
        self.seen: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        if request.url.host == "tenants":
            assert request.headers["host"] == HOST
            return httpx.Response(200, json={"id": "ev-a", "name": self.name, "status": "live"})
        ServiceIdentity("theming", KEY).require(request.headers[SERVICE_HEADER], ["bot"])
        assert request.url.params["tenant_id"] == "ev-a"
        return httpx.Response(200, json={"revision": 3, "embed_color": self.color})


class Clock:
    t = 0.0

    def __call__(self) -> float:
        return self.t


def look(outside: Outside, clock: Clock | None = None) -> EventLook:
    http = httpx.AsyncClient(transport=httpx.MockTransport(outside))
    return EventLook(
        "http://tenants", "http://theming", ServiceIdentity("bot", KEY), http, clock or Clock()
    )


async def test_the_name_and_colour_are_the_events_and_kept_a_minute(env: Env) -> None:
    outside, clock = Outside(), Clock()
    event = look(outside, clock)
    ctx = {**env.contexts["ev-a"], "primary_hostname": HOST}
    assert await event.of(ctx) == Look("Demo Event", 0x3366FF)  # type: ignore[arg-type]
    outside.name = "Renamed"
    clock.t = 59
    assert (await event.of(ctx)).name == "Demo Event"  # type: ignore[arg-type]
    clock.t = 61
    assert (await event.of(ctx)).name == "Renamed"  # type: ignore[arg-type]
    outside.name = "Again"
    event.forget("ev-a")
    assert (await event.of(ctx)).name == "Again"  # type: ignore[arg-type]


async def test_without_a_hostname_or_a_good_answer_nothing_is_made_up(env: Env) -> None:
    outside = Outside()
    outside.color = "#3366ff"
    assert await look(outside).of(env.contexts["ev-a"]) == Look(None, None)


async def test_the_nickname_is_the_events_name_cut_to_discords_length(env: Env) -> None:
    guild = await bound(env)
    outside = Outside()
    outside.name = "Demo Event with a name far longer than Discord takes"
    d = replace(env.deps, look=look(outside))
    await set_nickname(d, {**env.contexts["ev-a"], "primary_hostname": HOST})
    assert guild.nicks[SHARED_ID] == "Demo Event with a name far longe"


async def test_a_name_change_renames_the_bot(env: Env) -> None:
    guild = await bound(env)
    outside = Outside()
    d = replace(env.deps, look=look(outside))
    env.contexts["ev-a"]["primary_hostname"] = HOST
    await set_nickname(d, env.contexts["ev-a"])
    outside.name = "Demo Event Finals"
    other = tenant_event("ev-a", "tenants.tenant.changed", {"changed": ["description"]})
    await on_tenant(d, Directory(d), other)
    assert guild.nicks[SHARED_ID] == "Demo Event"
    renamed = tenant_event("ev-a", "tenants.tenant.changed", {"changed": ["name"]})
    await on_tenant(d, Directory(d), renamed)
    assert guild.nicks[SHARED_ID] == "Demo Event Finals"


async def test_a_bind_names_the_bot_after_the_event(env: Env) -> None:
    env.contexts["ev-a"]["primary_hostname"] = HOST
    env.deps.look = look(Outside())
    user, guild = organiser(env)
    await bind(env, user, guild)
    assert guild.nicks[SHARED_ID] == "Demo Event"
