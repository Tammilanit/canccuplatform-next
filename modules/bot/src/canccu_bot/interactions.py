"""Running a command (contracts/bot.md, The command framework; E5 of the step 6 plan).

The router hands an interaction here only for a guild bound for this client's application and an
event that is not archived, inside the event's tenant. Every answer is private. A command, or a
component that does not open a form, is deferred at once, so Discord's 3-second limit never
decides; the handler then has 10 seconds, after which the person reads "did not answer in time.
Nothing was sent" and the handler is stopped. Every module call carries the interaction id as its
idempotency key, so a call that did land is not made twice when the person tries again. The flag
is checked again here: a command registered before its flag went off says it is not on, and does
nothing."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from canccu_kit import current_tenant
from canccu_kit.access import TenantContext

from . import providers
from .deps import Deps
from .framework import (
    BUTTON_STYLES,
    Button,
    Caller,
    Command,
    Context,
    Form,
    NeedsSignIn,
    NoRight,
    Refused,
    Reply,
    Unreachable,
)
from .guard import guarded
from .texts import pick, text

log = logging.getLogger("canccu_bot.interactions")

COMMAND, COMPONENT, MODAL_SUBMIT = 2, 3, 5
MESSAGE, DEFERRED_MESSAGE, DEFERRED_UPDATE, MODAL = 4, 5, 6, 9
EPHEMERAL = 64
DEADLINE_S = 10.0
EXPIRY_MAX_S = 15 * 60
"""Discord lets the bot edit a private answer for 15 minutes: a later expiry cannot be shown."""


def caller_of(data: dict[str, Any]) -> Caller:
    member = data.get("member") or {}
    user = member.get("user") or data.get("user") or {}
    name = member.get("nick") or user.get("global_name") or user.get("username") or ""
    return Caller(
        user_id=str(user.get("id", "")),
        nickname=str(name),
        role_ids=tuple(str(r) for r in member.get("roles") or ()),
        guild_id=data.get("guild_id"),
        locale=data.get("locale"),
    )


def _options(data: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
    options = (data.get("data") or {}).get("options") or []
    if options and options[0].get("type") == 1:  # a subcommand holds the real options
        return str(options[0]["name"]), {
            o["name"]: o.get("value") for o in options[0].get("options") or []
        }
    return None, {o["name"]: o.get("value") for o in options}


def _values(data: dict[str, Any]) -> dict[str, str]:
    rows = (data.get("data") or {}).get("components") or []
    return {
        str(c["custom_id"]): str(c.get("value") or "")
        for row in rows
        for c in row.get("components") or []
    }


class Interactions:
    def __init__(
        self,
        d: Deps,
        application_id: str,
        context: Callable[[str], Awaitable[TenantContext | None]],
        rest: Callable[[], Any],
        *,
        deadline_s: float = DEADLINE_S,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._d = d
        self._application_id = application_id
        self._context = context
        self._rest = rest
        self._deadline = deadline_s
        self._sleep = sleep
        self._commands: dict[str, Command] = {c.name: c for c in d.commands}
        self._expiring: set[asyncio.Task[None]] = set()
        self._running: set[asyncio.Task[None]] = set()

    async def __call__(self, event: str, data: dict[str, Any]) -> None:
        """Starts the interaction as its own task and returns at once: the gateway's receive loop
        must read the next interaction while this one's handler runs, or a slow command would make
        every other one on the shard miss Discord's 3-second deferral. The task copies the
        router's tenant scope (contextvars) when it is created."""
        if current_tenant() is None:
            return
        task = asyncio.create_task(self._handle(data))
        self._running.add(task)
        task.add_done_callback(self._finished)

    def _finished(self, task: asyncio.Task[None]) -> None:
        self._running.discard(task)
        if not task.cancelled() and task.exception() is not None:
            log.error("an interaction failed", exc_info=task.exception())

    async def settled(self) -> None:
        while self._running:
            await asyncio.wait(set(self._running))

    async def _handle(self, data: dict[str, Any]) -> None:
        tenant = current_tenant()  # the router's: the guild's route, never a field of Discord's
        if tenant is None:
            return
        ctx = await self._context(tenant)
        if ctx is None:
            return
        kind = data.get("type")
        if kind == COMMAND:
            await self._command(ctx, data)
        elif kind in (COMPONENT, MODAL_SUBMIT):
            await self._component(ctx, data)

    async def _callback(self, ctx: TenantContext, data: dict[str, Any], body: Any) -> None:
        path = f"/interactions/{data['id']}/{data['token']}/callback"
        await self._rest().request("POST", path, tenant=ctx["tenant_id"], json=body)

    async def _say(self, ctx: TenantContext, data: dict[str, Any], content: str) -> None:
        message = guarded({"content": content, "flags": EPHEMERAL})
        await self._callback(ctx, data, {"type": MESSAGE, "data": message})

    async def _event_name(self, ctx: TenantContext, locale: str | None) -> tuple[str, int | None]:
        look = None if self._d.look is None else await self._d.look.of(ctx)
        name = look.name if look is not None and look.name else text("this_event", locale)
        return name, None if look is None else look.color

    def _usable(self, ctx: TenantContext, name: str | None) -> Command | None:
        command = self._commands.get(name or "")
        if command is None or not ctx["flags"].get(command.flag, False):
            return None
        return command

    async def _command(self, ctx: TenantContext, data: dict[str, Any]) -> None:
        name = str((data.get("data") or {}).get("name") or "")
        command = self._usable(ctx, name)
        locale = data.get("locale")
        if command is None:
            event, _ = await self._event_name(ctx, locale)
            await self._say(ctx, data, text("feature_off", locale, command=name, event=event))
            return
        await self._callback(ctx, data, {"type": DEFERRED_MESSAGE, "data": {"flags": EPHEMERAL}})
        sub, options = _options(data)
        await self._run(ctx, data, command, sub, options, lambda c: command.run(c))

    async def _component(self, ctx: TenantContext, data: dict[str, Any]) -> None:
        custom_id = str((data.get("data") or {}).get("custom_id") or "")
        locale = data.get("locale")
        found = None
        if self._d.components is not None:
            found = self._d.components.read(custom_id, ctx["tenant_id"], self._d.now())
        known = None if found is None else self._commands.get(found.command)
        if found is None or known is None or known.on_component is None:
            await self._say(ctx, data, text("old_component", locale))
            return
        command = self._usable(ctx, found.command)
        if command is None or command.on_component is None:
            event, _ = await self._event_name(ctx, locale)
            await self._say(ctx, data, text("feature_off", locale, command=known.name, event=event))
            return
        handle = command.on_component
        opener = command.forms.get(found.step) if data.get("type") == COMPONENT else None
        if opener is not None:  # a form opens at once: Discord takes no modal after a deferral
            context = await self._context_for(ctx, data, command, None, {})
            await self._callback(ctx, data, self._form(ctx, command, opener(context, found)))
            return
        await self._callback(ctx, data, {"type": DEFERRED_UPDATE})
        values = _values(data)
        await self._run(ctx, data, command, None, {}, lambda c: handle(c, found, values))

    async def _context_for(
        self,
        ctx: TenantContext,
        data: dict[str, Any],
        command: Command,
        sub: str | None,
        options: dict[str, Any],
    ) -> Context:
        d, tenant, caller = self._d, ctx["tenant_id"], caller_of(data)
        event, _ = await self._event_name(ctx, caller.locale)

        async def act(module: str, method: str, path: str, json: Any) -> Any:
            if d.acting is None:
                raise Unreachable()
            return await d.acting.call(
                tenant=tenant,
                host=ctx["primary_hostname"],
                discord_user_id=caller.user_id,
                module=module,
                method=method,
                path=path,
                json=json,
                idempotency_key=str(data["id"]),
            )

        async def provider(name: str, method: str, url: str, json: Any) -> Any:
            if d.http is None:
                raise Unreachable()
            return await providers.call(d, d.http, tenant, name, method, url, json)

        def component(step: str, args: str) -> str:
            if d.components is None:
                raise RuntimeError("components need the bot's component key")
            return d.components.make(tenant, command.name, step, args, d.now())

        return Context(
            caller, tenant, event, str(data["id"]), sub, options, act, provider, component
        )

    async def _run(
        self,
        ctx: TenantContext,
        data: dict[str, Any],
        command: Command,
        sub: str | None,
        options: dict[str, Any],
        handler: Callable[[Context], Awaitable[Reply]],
    ) -> None:
        context = await self._context_for(ctx, data, command, sub, options)
        locale = context.caller.locale
        try:
            reply = await asyncio.wait_for(handler(context), self._deadline)
        except TimeoutError:
            reply = Reply(text("too_slow", locale, event=context.event_name))
        except NeedsSignIn:
            reply = self._sign_in(ctx, command, context)
        except NoRight as exc:
            named = command.right_names.get(exc.right)
            reply = Reply(
                text("no_right", locale, right=pick(named, locale), command=command.name)
                if named
                else text("no_right_unnamed", locale, command=command.name)
            )
        except Unreachable:
            reply = Reply(text("unreachable", locale, event=context.event_name))
        except Refused as exc:
            said = command.errors.get(exc.code)
            reply = Reply(pick(said, locale) if said else text("failed", locale))
        except Exception:
            log.exception("command /%s failed", command.name)
            reply = Reply(text("failed", locale))
        await self._edit(ctx, data, command, reply)

    def _sign_in(self, ctx: TenantContext, command: Command, context: Context) -> Reply:
        locale = context.caller.locale
        said = text("sign_in", locale, event=context.event_name, command=command.name)
        host = ctx["primary_hostname"]
        if host is None:
            return Reply(said)
        url = self._d.hosts.event_url(host, "/admin/sign-in")
        return Reply(said, buttons=[Button(text("sign_in_button", locale), url=url, style="link")])

    def _form(self, ctx: TenantContext, command: Command, form: Form) -> dict[str, Any]:
        custom_id = self._d.components.make(  # type: ignore[union-attr]
            ctx["tenant_id"], command.name, form.step, form.args, self._d.now()
        )
        rows = [
            {
                "type": 1,
                "components": [
                    {
                        "type": 4,
                        "custom_id": f.id,
                        "label": f.label,
                        "style": 1,
                        "value": f.value,
                        "max_length": f.max_length,
                        "required": f.required,
                    }
                ],
            }
            for f in form.fields
        ]
        return {
            "type": MODAL,
            "data": {"custom_id": custom_id, "title": form.title, "components": rows},
        }

    def _message(
        self, ctx: TenantContext, command: Command, reply: Reply, color: int | None
    ) -> dict[str, Any]:
        embeds = [
            e if "color" in e or color is None else {**e, "color": color} for e in reply.embeds
        ]
        buttons = []
        for b in reply.buttons:
            button: dict[str, Any] = {"type": 2, "label": b.label, "style": BUTTON_STYLES[b.style]}
            if b.url is not None:
                button |= {"style": BUTTON_STYLES["link"], "url": b.url}
            else:
                button["custom_id"] = self._d.components.make(  # type: ignore[union-attr]
                    ctx["tenant_id"], command.name, b.step, b.args, self._d.now()
                )
            buttons.append(button)
        rows = [{"type": 1, "components": buttons[i : i + 5]} for i in range(0, len(buttons), 5)]
        return guarded(
            {"content": reply.content, "embeds": embeds, "components": rows, "flags": EPHEMERAL}
        )

    async def _edit(
        self, ctx: TenantContext, data: dict[str, Any], command: Command, reply: Reply
    ) -> None:
        _, color = await self._event_name(ctx, data.get("locale"))
        path = f"/webhooks/{self._application_id}/{data['token']}/messages/@original"
        tenant = ctx["tenant_id"]
        try:
            await self._rest().request(
                "PATCH", path, tenant=tenant, json=self._message(ctx, command, reply, color)
            )
        except Exception:
            log.warning("answering /%s failed", command.name, exc_info=True)
            return
        if reply.expires_at is not None:
            task = asyncio.create_task(self._expire(ctx, data, command, reply))
            self._expiring.add(task)
            task.add_done_callback(self._expiring.discard)

    async def _expire(
        self, ctx: TenantContext, data: dict[str, Any], command: Command, reply: Reply
    ) -> None:
        """The provider's link has run out: the answer says to run the command again."""
        assert reply.expires_at is not None
        left = (reply.expires_at - self._d.now()).total_seconds()
        if left >= EXPIRY_MAX_S:
            return
        await self._sleep(max(left, 0.0))
        said = text("link_expired", data.get("locale"), command=command.name)
        path = f"/webhooks/{self._application_id}/{data['token']}/messages/@original"
        body = guarded({"content": said, "embeds": [], "components": [], "flags": EPHEMERAL})
        try:
            await self._rest().request("PATCH", path, tenant=ctx["tenant_id"], json=body)
        except Exception:
            log.warning("expiring /%s's link failed", command.name, exc_info=True)

    def close(self) -> None:
        for task in (*self._expiring, *self._running):
            task.cancel()
