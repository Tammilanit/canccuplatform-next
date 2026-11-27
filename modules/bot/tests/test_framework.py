"""The command framework (contracts/bot.md, The command framework; What `/finals` needs, step 6
plan), proved with `/trial` against the fake Discord, a fake admin, a fake module and a fake
provider: deferred at once and answered privately within 10 s, subcommands, a button with a
confirm, a form, a link button that expires, a bearer call to a provider, error codes as replies,
the acting token with an idempotency key, the sign-in reply, and all of it after a restart."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field, replace
from datetime import timedelta
from typing import Any

import httpx
import pytest
from canccu_kit import ACTING_HEADER, SERVICE_HEADER, ServiceIdentity, tenant_scope
from conftest import API, NOW, SHARED_ID, Env
from trial import FLAG, TRIAL

from canccu_bot.acting import ActingClient
from canccu_bot.components import ComponentKeys
from canccu_bot.framework import Command
from canccu_bot.interactions import Interactions
from canccu_bot.look import Look
from canccu_bot.providers import secret_aad
from canccu_bot.rest import RestClient

KEY = b"bot-tests-service-key-0123456789abcdef"
BOT_ADMIN = b"bot-tests-bot-admin-key-0123456789abcdef"
GUILD = "100000000000000501"
HOST = "a.example.test"
PLAYER, STRANGER, CREW = "100000000000000901", "100000000000000902", "100000000000000903"


@dataclass
class Outside:
    """Admin, a module and the Finals provider, as the bot meets them."""

    module_calls: list[httpx.Request] = field(default_factory=list)
    provider_calls: list[httpx.Request] = field(default_factory=list)
    slow: bool = False
    provider_error: tuple[int, str] | None = None

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "admin":
            assert request.headers["x-canccu-bot-admin-key"] == BOT_ADMIN.decode()
            ServiceIdentity("admin", KEY).require(request.headers[SERVICE_HEADER], ["bot"])
            who = json.loads(request.read())["discord_user_id"]
            if who == STRANGER:
                return httpx.Response(404, json={"error": {"code": "no_account", "message": "x"}})
            return httpx.Response(201, json={"token": f"acting-{who}", "expires_at": "x"})
        if request.url.host == "moments":
            self.module_calls.append(request)
            ServiceIdentity("moments", KEY).require(request.headers[SERVICE_HEADER], ["bot"])
            if self.slow:
                await asyncio.sleep(5)
            if request.headers[ACTING_HEADER] != f"acting-{CREW}":
                body = {
                    "error": {"code": "missing_right", "message": "needs right moments.announce"}
                }
                return httpx.Response(403, json=body)
            return httpx.Response(201, json={"id": "a1"})
        self.provider_calls.append(request)
        if self.provider_error is not None:
            status, code = self.provider_error
            return httpx.Response(status, json={"error": {"code": code, "message": "x"}})
        if request.method == "POST":
            return httpx.Response(200, json={"ok": True})
        expires = (NOW + timedelta(minutes=10)).isoformat()
        season = {"id": "s7", "name": "Season 7", "url": "https://finals.example.test/s7"}
        return httpx.Response(200, json={**season, "expires_at": expires})


class FakeLook:
    async def of(self, ctx: Any) -> Look:
        return Look("Demo Event", 0x3366FF)


@dataclass
class World:
    env: Env
    outside: Outside
    waits: list[float]

    def interactions(self) -> Interactions:
        """A fresh container: nothing of an earlier one survives but the database and the keys."""
        return interactions_with(self, TRIAL)

    @property
    def answers(self) -> list[dict[str, Any]]:
        return [body for _, body in self.env.discord.interaction_answers]

    @property
    def shown(self) -> dict[str, Any]:
        """What the person sees now: the last edit of an answer."""
        return dict(self.env.discord.interaction_edits[-1][1])


def interactions_with(world: World, trial: Command) -> Interactions:
    http = httpx.AsyncClient(transport=httpx.MockTransport(world.outside))
    d = replace(
        world.env.deps,
        commands=(trial,),
        components=ComponentKeys.from_service_key(KEY),
        acting=ActingClient(
            "http://admin",
            ServiceIdentity("bot", KEY),
            BOT_ADMIN,
            http,
            lambda m: f"http://{m}",
        ),
        look=FakeLook(),
        http=http,
    )
    app = world.env.discord.applications[SHARED_ID]
    rest = RestClient(app.token, http=world.env.discord.http_client(), api_url=API)

    async def context(tenant: str) -> Any:
        return world.env.contexts.get(tenant)

    async def sleep(seconds: float) -> None:
        world.waits.append(seconds)

    return Interactions(d, SHARED_ID, context, lambda: rest, deadline_s=0.3, sleep=sleep)


@pytest.fixture
async def world(env: Env) -> World:
    env.discord.guilds.setdefault(GUILD, env.discord.add_guild("Demo Community"))
    env.contexts["ev-a"]["flags"] = {FLAG: True}
    env.contexts["ev-a"]["primary_hostname"] = HOST
    sealed = env.deps.secrets.seal("finals-bearer", secret_aad("ev-a", "finals"))
    await env.sql(
        "ev-a",
        "INSERT INTO bot_provider_secrets (provider, secret, updated_at) VALUES ('finals', $1, $2)",
        sealed,
        NOW,
    )
    return World(env, Outside(), [])


_ids = iter(range(100000000000001000, 100000000000002000))


def member(user: str = PLAYER, locale: str = "en-US") -> dict[str, Any]:
    interaction = str(next(_ids))
    return {
        "id": interaction,
        "token": f"tok-{interaction}",
        "guild_id": GUILD,
        "locale": locale,
        "member": {
            "user": {"id": user, "username": "demo_player", "global_name": "Demo Player"},
            "nick": "Demo @everyone Player",
            "roles": ["100000000000000701"],
        },
    }


def command(sub: str, options: dict[str, Any] | None = None, **who: Any) -> dict[str, Any]:
    opts = [{"name": k, "type": 3, "value": v} for k, v in (options or {}).items()]
    data = {"name": "trial", "options": [{"name": sub, "type": 1, "options": opts}]}
    return {**member(**who), "type": 2, "data": data}


def click(custom_id: str, **who: Any) -> dict[str, Any]:
    return {**member(**who), "type": 3, "data": {"custom_id": custom_id, "component_type": 2}}


def submit(custom_id: str, values: dict[str, str]) -> dict[str, Any]:
    rows = [
        {"type": 1, "components": [{"type": 4, "custom_id": k, "value": v}]}
        for k, v in values.items()
    ]
    return {**member(), "type": 5, "data": {"custom_id": custom_id, "components": rows}}


async def run(w: World, data: dict[str, Any], interactions: Interactions | None = None) -> None:
    with tenant_scope("ev-a"):
        await (interactions or w.interactions())("INTERACTION_CREATE", data)


def buttons(shown: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {b["label"]: b for row in shown["components"] for b in row["components"]}


async def test_a_command_is_deferred_at_once_and_answered_privately(world: World) -> None:
    await run(world, command("status"))
    assert world.answers == [{"type": 5, "data": {"flags": 64}}]
    shown = world.shown
    assert shown["content"] == "Season 7: registration open"
    assert shown["flags"] == 64 and shown["allowed_mentions"] == {"parse": []}
    link = buttons(shown)["Open the page"]
    assert link == {
        "type": 2,
        "label": "Open the page",
        "style": 5,
        "url": "https://finals.example.test/s7",
    }
    assert "finals.example.test" not in shown["content"]  # the link is a button, not text


async def test_the_provider_gets_the_events_bearer_secret(world: World) -> None:
    await run(world, command("status"))
    [call] = world.outside.provider_calls
    assert call.headers["authorization"] == "Bearer finals-bearer"


async def test_a_button_and_its_confirm_work_after_a_restart(world: World) -> None:
    await run(world, command("status"))
    register = buttons(world.shown)["Register"]["custom_id"]
    await run(world, click(register), world.interactions())  # another container
    assert world.answers[-1] == {"type": 6}
    assert world.shown["content"] == "Register for this season?"
    confirm = buttons(world.shown)
    await run(world, click(confirm["No"]["custom_id"]), world.interactions())
    assert world.shown["content"] == "Nothing was sent."
    assert [c.method for c in world.outside.provider_calls] == ["GET"]
    await run(world, click(confirm["Yes"]["custom_id"]), world.interactions())
    assert world.shown["content"] == "Registered as Demo @everyone Pla."  # cut to 18
    assert world.shown["allowed_mentions"] == {"parse": []}  # a nickname never pings
    posted = world.outside.provider_calls[-1]
    assert posted.method == "POST" and b'"season":"s7"' in posted.read().replace(b" ", b"")


async def test_a_form_opens_at_once_and_its_values_reach_the_handler(world: World) -> None:
    await run(world, command("status"))
    await run(world, click(buttons(world.shown)["Another name"]["custom_id"]), world.interactions())
    modal = world.answers[-1]
    assert modal["type"] == 9 and modal["data"]["title"] == "Register with a name"
    field_ = modal["data"]["components"][0]["components"][0]
    assert (field_["custom_id"], field_["value"], field_["max_length"]) == (
        "name",
        "Demo @everyone Pla",
        18,
    )
    await run(world, submit(modal["data"]["custom_id"], {"name": "Champion"}), world.interactions())
    assert world.answers[-1] == {"type": 6}
    assert world.shown["content"] == "Registered as Champion."


@pytest.mark.parametrize(
    "custom_id",
    ["", "c1.trial.yes.s7.0.AAAAAAAAAAAAAAAA", "something-else"],
)
async def test_a_forged_or_unknown_component_is_called_old(world: World, custom_id: str) -> None:
    await run(world, click(custom_id))
    assert world.answers[-1]["type"] == 4
    assert world.answers[-1]["data"]["content"] == "This button is old. Run the command again."
    assert world.outside.provider_calls == []


async def test_an_old_component_is_refused(world: World) -> None:
    await run(world, command("status"))
    register = buttons(world.shown)["Register"]["custom_id"]
    later = replace(world.env.deps, now=lambda: NOW + timedelta(minutes=16))
    world.env.deps = later
    await run(world, click(register))
    assert world.answers[-1]["data"]["content"] == "This button is old. Run the command again."


async def test_a_flag_turned_off_is_checked_again_in_the_handler(world: World) -> None:
    await run(world, command("status"))
    register = buttons(world.shown)["Register"]["custom_id"]
    world.env.contexts["ev-a"]["flags"] = {FLAG: False}
    await run(world, command("status"))
    await run(world, click(register))
    off = "/trial is not on at Demo Event. Ask the crew; the command goes away within a minute."
    assert [a["data"]["content"] for a in world.answers[-2:]] == [off, off]
    assert len(world.outside.provider_calls) == 1


async def test_a_module_call_carries_the_acting_token_and_the_idempotency_key(world: World) -> None:
    data = command("announce", {"text": "Doors open"}, user=CREW)
    await run(world, data)
    [call] = world.outside.module_calls
    assert call.url.path == "/api/moments/announcements"
    assert call.headers[ACTING_HEADER] == f"acting-{CREW}"
    assert call.headers["idempotency-key"] == data["id"]
    assert call.headers["host"] == HOST
    assert world.shown["embeds"] == [{"title": "Sent to Demo Event", "color": 0x3366FF}]


async def test_someone_without_an_account_gets_a_sign_in_link(world: World) -> None:
    await run(world, command("announce", {"text": "x"}, user=STRANGER))
    shown = world.shown
    assert shown["content"] == (
        "Sign in to Demo Event once to use /trial. Then your roles bring the rights."
    )
    assert buttons(shown)["Sign in"]["url"] == f"https://{HOST}/admin/sign-in"
    assert world.outside.module_calls == []


async def test_someone_without_the_right_is_told_which_in_words(world: World) -> None:
    await run(world, command("announce", {"text": "x"}))
    assert world.shown["content"] == "You need the Announce right for /trial. Ask an event admin."
    await run(world, command("announce", {"text": "x"}, locale="fi"))
    assert world.shown["content"] == (
        "Tarvitset Tiedotus-oikeuden komentoon /trial. Kysy tapahtuman ylläpitäjältä."
    )


async def test_a_right_the_command_did_not_name_is_never_shown_as_an_id(world: World) -> None:
    unnamed = replace(TRIAL, right_names={})
    world.interactions = lambda: interactions_with(world, unnamed)  # type: ignore[method-assign]
    await run(world, command("announce", {"text": "x"}))
    assert world.shown["content"] == (
        "/trial needs a right you do not have yet. Ask an event admin."
    )


async def test_a_slow_module_answers_in_time_that_nothing_was_sent(world: World) -> None:
    world.outside.slow = True
    await run(world, command("announce", {"text": "x"}, user=CREW))
    assert world.shown["content"] == (
        "Demo Event did not answer in time. Nothing was sent. Try again in a moment."
    )


@pytest.mark.parametrize(
    ("error", "locale", "said"),
    [
        ((409, "registration_closed"), "en-US", "Registration is closed."),
        ((409, "registration_closed"), "fi", "Ilmoittautuminen on suljettu."),
        ((400, "something_new"), "en-US", "That did not work. Try again later."),
        ((503, "down"), "en-US", "Demo Event is not reachable right now. Try again in a moment."),
    ],
)
async def test_errors_become_short_private_sentences(
    world: World, error: tuple[int, str], locale: str, said: str
) -> None:
    world.outside.provider_error = error
    await run(world, command("status", locale=locale))
    assert world.shown["content"] == said


async def test_a_provider_link_expires_with_the_providers_time(world: World) -> None:
    interactions = world.interactions()
    await run(world, command("status"), interactions)
    await asyncio.sleep(0)  # the expiry's own task
    for _ in range(3):
        await asyncio.sleep(0)
    assert world.waits == [600.0]
    assert world.shown == {
        "content": "This link has expired. Run /trial again.",
        "embeds": [],
        "components": [],
        "flags": 64,
        "allowed_mentions": {"parse": []},
    }


def test_the_command_registers_with_subcommands_and_its_languages() -> None:
    payload = TRIAL.payload()
    assert payload["name"] == "trial" and payload["name_localizations"] == {"fi": "kokeilu"}
    assert payload["description_localizations"] == {"fi": "Kokeile kehystä"}
    announce = payload["options"][1]
    assert announce["type"] == 1 and announce["options"][0]["required"] is True
