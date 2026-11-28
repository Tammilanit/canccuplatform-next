"""The real commands against the fake Discord, a fake admin and fake modules (Screen, Moments,
Pizza, Agenda) that check the person's rights as the modules do: a transcript of what a person
sees, held against mockups 07 to 09 of the step 6 brief."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from typing import Any

import httpx
from canccu_kit import ACTING_HEADER, ServiceIdentity, tenant_scope
from conftest import API, SHARED_ID, Env
from fakes import MemoryKeys
from test_framework import BOT_ADMIN, GUILD, HOST, KEY, FakeLook

from canccu_bot.acting import ActingClient
from canccu_bot.commands import COMMANDS
from canccu_bot.components import ComponentKeys
from canccu_bot.interactions import Interactions
from canccu_bot.rest import RestClient

PLAYER, STRANGER, CREW = "100000000000000901", "100000000000000902", "100000000000000903"
CDN = "https://cdn.discordapp.com/attachments/1/2/team.jpg"
Responder = Callable[[httpx.Request], httpx.Response]


@dataclass
class Outside:
    """Admin (the acting token), the modules and Discord's file host, as the bot meets them."""

    rights: dict[str, set[str]] = field(default_factory=dict)
    routes: dict[tuple[str, str, str], tuple[str | None, Responder]] = field(default_factory=dict)
    calls: list[httpx.Request] = field(default_factory=list)
    files: dict[str, bytes] = field(default_factory=dict)
    slow: bool = False

    def on(self, module: str, method: str, path: str, right: str | None, answer: Any) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            if callable(answer):
                result: httpx.Response = answer(request)
                return result
            return httpx.Response(200 if method != "DELETE" else 204, json=answer)

        self.routes[(module, method, path)] = (right, respond)

    def bodies(self, module: str, method: str, path: str) -> list[Any]:
        return [
            json.loads(r.read()) if r.read() else None
            for r in self.calls
            if (r.url.host, r.method, r.url.path) == (module, method, path)
        ]

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host == "admin":
            who = json.loads(request.read())["discord_user_id"]
            if who == STRANGER:
                return httpx.Response(404, json={"error": {"code": "no_account", "message": "x"}})
            return httpx.Response(201, json={"token": f"acting-{who}", "expires_at": "x"})
        if host.endswith("discordapp.com") or host.endswith("discordapp.net"):
            found = self.files.get(str(request.url))
            return httpx.Response(200, content=found) if found else httpx.Response(404)
        self.calls.append(request)
        if self.slow:
            await asyncio.sleep(5)
        who = request.headers[ACTING_HEADER].removeprefix("acting-")
        right, respond = self.routes[(host, request.method, request.url.path)]
        if right is not None and right not in self.rights.get(who, set()):
            body = {"error": {"code": "missing_right", "message": f"needs right {right}"}}
            return httpx.Response(403, json=body)
        return respond(request)


@dataclass
class World:
    env: Env
    outside: Outside
    keys: MemoryKeys = field(default_factory=MemoryKeys)

    def interactions(self) -> Interactions:
        """A fresh container: only the database and Valkey's keys outlive it."""
        http = httpx.AsyncClient(transport=httpx.MockTransport(self.outside))
        d = replace(
            self.env.deps,
            commands=COMMANDS,
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
            keys=self.keys,
        )
        app = self.env.discord.applications[SHARED_ID]
        rest = RestClient(app.token, http=self.env.discord.http_client(), api_url=API)

        async def context(tenant: str) -> Any:
            return self.env.contexts.get(tenant)

        return Interactions(d, SHARED_ID, context, lambda: rest, deadline_s=0.3)

    async def run(self, data: dict[str, Any]) -> None:
        with tenant_scope("ev-a"):
            started = self.interactions()
            await started("INTERACTION_CREATE", data)
            await started.settled()

    @property
    def answers(self) -> list[dict[str, Any]]:
        return [body for _, body in self.env.discord.interaction_answers]

    @property
    def shown(self) -> dict[str, Any]:
        """What the person sees now: the last edit of an answer."""
        return dict(self.env.discord.interaction_edits[-1][1])

    @property
    def text(self) -> str:
        """The answer as a person reads it: its text, then each embed's title, lines and footer."""
        shown = self.shown
        parts = [shown.get("content") or ""]
        for embed in shown.get("embeds") or []:
            parts += [embed.get("title") or "", embed.get("description") or ""]
            parts.append((embed.get("footer") or {}).get("text") or "")
        return "\n".join(p for p in parts if p)


_ids = iter(range(100000000000003000, 100000000000004000))


def person(user: str = PLAYER, locale: str = "en-US") -> dict[str, Any]:
    interaction = str(next(_ids))
    return {
        "id": interaction,
        "token": f"tok-{interaction}",
        "guild_id": GUILD,
        "locale": locale,
        "member": {
            "user": {"id": user, "username": "demo_player", "global_name": "Demo Player"},
            "nick": "Demo Player",
            "roles": [],
        },
    }


def slash(
    name: str,
    sub: str | None = None,
    options: dict[str, Any] | None = None,
    *,
    group: str | None = None,
    **who: Any,
) -> dict[str, Any]:
    opts = [{"name": k, "type": 3, "value": v} for k, v in (options or {}).items()]
    data: dict[str, Any] = {"name": name, "type": 1}
    if sub is not None:
        data["options"] = [{"name": sub, "type": 1, "options": opts}]
        if group is not None:
            data["options"] = [{"name": group, "type": 2, "options": data["options"]}]
    elif opts:
        data["options"] = opts
    return {**person(**who), "type": 2, "data": data}


def menu(name: str, message: dict[str, Any], **who: Any) -> dict[str, Any]:
    data = {
        "name": name,
        "type": 3,
        "target_id": message["id"],
        "resolved": {"messages": {message["id"]: message}},
    }
    return {**person(**who), "type": 2, "data": data}


def click(custom_id: str, **who: Any) -> dict[str, Any]:
    return {**person(**who), "type": 3, "data": {"custom_id": custom_id, "component_type": 2}}


def submit(custom_id: str, values: dict[str, str], **who: Any) -> dict[str, Any]:
    rows = [
        {"type": 1, "components": [{"type": 4, "custom_id": k, "value": v}]}
        for k, v in values.items()
    ]
    return {**person(**who), "type": 5, "data": {"custom_id": custom_id, "components": rows}}


def buttons(shown: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {b["label"]: b for row in shown["components"] for b in row["components"]}


def make_world(env: Env, flags: dict[str, bool] | None = None) -> World:
    env.discord.guilds.setdefault(GUILD, env.discord.add_guild("Demo Community"))
    env.contexts["ev-a"]["flags"] = dict(flags or {})
    env.contexts["ev-a"]["primary_hostname"] = HOST
    env.contexts["ev-a"]["time_zone"] = "Europe/Helsinki"
    return World(env, Outside())
