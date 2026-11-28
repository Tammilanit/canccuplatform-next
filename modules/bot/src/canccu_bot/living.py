"""The living messages' editor (D6 of docs/plans/issue-122.md; L1, E1, E2, E4 of the step 6 plan;
contracts/bot.md, Living messages): one per client, in the container that holds the client's
lease, so every post, edit and pin goes through the event's own queue.

What a message should show is recorded by any container (food.py from the pizza events, a
version bump of the board on the agenda's and pizza's events); every few seconds the editor
shows each changed one. A message is edited only when what it shows changed, and a channel gets
at most one edit a minute (Discord's edit limits): the edit that waits shows the latest state when
its minute comes. A new message is posted at once. After a gap (a guild's snapshot, a resumed
session, a pin change or a deleted message in the guild) the editor checks that each message is
still there and the board still pinned, and posts or pins it again. While the client is not ready
nothing is sent; the messages catch up once it is (E1)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from canccu_kit.access import TenantContext

from . import board, food
from .deps import Deps
from .rest import RestError
from .router import Directory

log = logging.getLogger("canccu_bot.living")

KINDS = [board.KIND, food.KIND]
PURPOSE = {board.KIND: "now_and_next", food.KIND: "food"}
EDIT_EVERY = timedelta(minutes=1)
TICK_S = 5.0


class _NotNow(Exception):
    """Discord cannot take it now (rate limit, outage, client stopped): try on a later tick."""


@dataclass
class _Row:
    kind: str
    key: str
    channel_id: str
    message_id: str | None
    state: dict[str, Any] | None
    version: int
    shown_version: int
    shown_hash: str | None
    edited_at: datetime | None
    verify: bool

    @property
    def due(self) -> bool:
        return self.verify or self.version > self.shown_version

    @property
    def ended(self) -> bool:
        return self.state is not None and self.state.get("state") in food.FINAL


def _hash(body: dict[str, Any]) -> str:
    """What the message shows, without its footer: the board's edit time is no change."""
    embeds = [{k: v for k, v in e.items() if k != "footer"} for e in body.get("embeds", [])]
    shown = json.dumps({**body, "embeds": embeds}, sort_keys=True)
    return hashlib.sha256(shown.encode()).hexdigest()


def _retry_later(exc: RestError) -> bool:
    return exc.status in (0, 401, 429) or exc.status >= 500


class Editor:
    def __init__(self, d: Deps, application_id: str, directory: Directory) -> None:
        self._d = d
        self._app = application_id
        self._directory = directory
        self._task: asyncio.Task[None] | None = None
        self.rest: Any = None
        """The client's RestClient, set once the client exists."""
        self.ready: Callable[[], bool] = lambda: False
        """Whether the client is ready now; set once the client exists."""

    async def _ours(self, guild_id: Any) -> str | None:
        route = None if guild_id is None else await self._directory.route(str(guild_id))
        return route[0] if route is not None and route[1] == self._app else None

    async def _check(self, tenant: str, extra: str = "", *args: Any) -> None:
        async with self._d.db.tenant(tenant) as conn:
            await conn.execute(
                "UPDATE bot_posts SET verify = true"
                f" WHERE kind = ANY($1) AND message_id IS NOT NULL{extra}",
                KINDS,
                *args,
            )

    async def on_gateway(self, event: str, data: dict[str, Any]) -> None:
        """The gaps after which a message may be gone or unpinned."""
        if event == "RESUMED":
            for served in await self._directory.guilds_of(self._app):
                await self._check(served)
            return
        if event not in ("GUILD_CREATE", "CHANNEL_PINS_UPDATE", "MESSAGE_DELETE"):
            return
        tenant = await self._ours(data.get("id" if event == "GUILD_CREATE" else "guild_id"))
        if tenant is None:
            return
        if event == "CHANNEL_PINS_UPDATE":
            await self._check(tenant, " AND channel_id = $2", str(data.get("channel_id")))
        elif event == "MESSAGE_DELETE":
            await self._check(tenant, " AND message_id = $2", str(data.get("id")))
        else:
            await self._check(tenant)

    async def tick(self) -> None:
        if self.rest is None or not self.ready():
            return
        try:
            routes = await self._directory.guilds_of(self._app)
        except Exception:
            log.exception("reading the guild routes of application %s failed", self._app)
            return
        for tenant in routes:
            try:
                ctx = await self._directory.context(tenant, fresh=True)
                if ctx is not None and ctx["status"] != "archived":
                    await self.flush(ctx)
            except _NotNow:
                log.info("living messages of %s wait for Discord", tenant)
            except Exception:
                log.exception("editing the living messages of %s failed", tenant)

    async def _rows(self, tenant: str) -> list[_Row]:
        """The event's living messages whose purpose has a channel; the board's row made when
        its channel is first bound, and a message whose purpose moved starts again there."""
        async with self._d.db.tenant(tenant) as conn:
            if await conn.fetchval("SELECT guild_id FROM bot_bindings") is None:
                return []
            picked = await conn.fetch(
                "SELECT purpose, target_id FROM bot_purposes WHERE purpose = ANY($1)",
                list(PURPOSE.values()),
            )
            targets = {r["purpose"]: r["target_id"] for r in picked}
            if board_channel := targets.get("now_and_next"):
                await conn.execute(
                    "INSERT INTO bot_posts (kind, key, channel_id, updated_at, version)"
                    " VALUES ($1, $2, $3, $4, 1) ON CONFLICT DO NOTHING",
                    board.KIND,
                    board.KEY,
                    board_channel,
                    self._d.now(),
                )
            for kind, purpose in PURPOSE.items():
                if channel := targets.get(purpose):
                    await conn.execute(
                        "UPDATE bot_posts SET channel_id = $1, message_id = NULL,"
                        " shown_hash = NULL, verify = false, version = version + 1"
                        " WHERE kind = $2 AND channel_id <> $1"
                        " AND coalesce(state->>'state', '') <> ALL($3)",
                        channel,
                        kind,
                        list(food.FINAL),
                    )
            rows = await conn.fetch(
                "SELECT kind, key, channel_id, message_id, state, version, shown_version,"
                " shown_hash, edited_at, verify FROM bot_posts WHERE kind = ANY($1)"
                " ORDER BY kind, updated_at",
                KINDS,
            )
        kept = [r for r in rows if PURPOSE[r["kind"]] in targets]
        return [
            _Row(**{**dict(r), "state": None if r["state"] is None else json.loads(r["state"])})
            for r in kept
        ]

    async def flush(self, ctx: TenantContext) -> None:
        tenant = ctx["tenant_id"]
        rows = await self._rows(tenant)
        due = [r for r in rows if r.due]
        if not due:
            return
        edited: dict[str, datetime] = {}
        for r in rows:
            last = edited.get(r.channel_id)
            if r.edited_at is not None and (last is None or r.edited_at > last):
                edited[r.channel_id] = r.edited_at
        look = None if self._d.look is None else await self._d.look.of(ctx)
        async with self._d.db.tenant(tenant) as conn:
            food_bound = (
                await conn.fetchval("SELECT true FROM bot_purposes WHERE purpose = 'food' LIMIT 1")
                is True
            )
        orders = [r.state for r in rows if r.kind == food.KIND and r.state is not None]
        for row in due:
            body = await self._body(ctx, row, look, orders, food_bound)
            if body is not None:
                await self._show(tenant, row, body, edited)

    async def _body(
        self,
        ctx: TenantContext,
        row: _Row,
        look: Any,
        orders: list[dict[str, Any]],
        food_bound: bool,
    ) -> dict[str, Any] | None:
        color = None if look is None else look.color
        if row.kind == food.KIND:
            host = ctx["primary_hostname"]

            def page(path: str) -> str | None:
                return None if host is None else self._d.hosts.event_url(host, path)

            return None if row.state is None else food.message(ctx, row.state, row.key, color, page)
        agenda = None if self._d.agenda is None else await self._d.agenda.now(ctx["tenant_id"])
        if agenda is None:
            return None  # the agenda did not answer: the board waits rather than say nothing
        # Orders are recorded only while a food channel is picked: without one the board would
        # say "nothing open" over an open order, so it leaves the food line out.
        food_on = ctx["flags"].get("pizza.enabled", False) and food_bound
        name = None if look is None else look.name
        return board.message(ctx, agenda, orders if food_on else None, name, color, self._d.now())

    async def _send(self, tenant: str, method: str, path: str, json: Any = None) -> Any:
        try:
            return await self.rest.request(method, path, tenant=tenant, json=json)
        except RestError as exc:
            if _retry_later(exc) or exc.code != "discord_error":
                raise _NotNow(exc.code) from exc
            raise

    async def _show(
        self, tenant: str, row: _Row, body: dict[str, Any], edited: dict[str, datetime]
    ) -> None:
        message_id = row.message_id
        if row.verify and message_id is not None:
            message_id = await self._still_there(tenant, row, message_id)
        shown = _hash(body)
        now = self._d.now()
        if message_id is None:
            if row.ended:  # an order that ended while its message was gone stays gone
                await self._record(tenant, row, None, row.shown_hash, None)
                return
            message_id = await self._post(tenant, row, body)
            await self._record(tenant, row, message_id, shown if message_id else None, None)
            return
        if shown == row.shown_hash:
            await self._record(tenant, row, message_id, shown, None)
            return
        last = edited.get(row.channel_id)
        if last is not None and now - last < EDIT_EVERY:
            await self._record(tenant, row, message_id, row.shown_hash, None, keep_version=True)
            return  # its channel had its edit this minute: the latest state shows next minute
        path = f"/channels/{row.channel_id}/messages/{message_id}"
        try:
            await self._send(tenant, "PATCH", path, body)
        except RestError as exc:
            log.info("editing %s %s failed (%s): posting it again", row.kind, row.key, exc.status)
            message_id = await self._post(tenant, row, body)
            await self._record(tenant, row, message_id, shown if message_id else None, None)
            return
        edited[row.channel_id] = now
        await self._record(tenant, row, message_id, shown, now)

    async def _still_there(self, tenant: str, row: _Row, message_id: str) -> str | None:
        """The message's id while it is there, pinned again if it is the board; else None."""
        try:
            await self._send(tenant, "GET", f"/channels/{row.channel_id}/messages/{message_id}")
        except RestError:
            return None
        if row.kind == board.KIND:
            pins = await self._send(tenant, "GET", f"/channels/{row.channel_id}/pins")
            if message_id not in {str(m.get("id")) for m in pins or []}:
                await self._pin(tenant, row.channel_id, message_id)
        return message_id

    async def _post(self, tenant: str, row: _Row, body: dict[str, Any]) -> str | None:
        """The new message's id; None when Discord refuses it for good (the channel is gone or
        the bot may not post there): dropped until the next change (E3)."""
        try:
            posted = await self._send(tenant, "POST", f"/channels/{row.channel_id}/messages", body)
        except RestError as exc:
            log.warning("posting %s %s failed: %s", row.kind, row.key, exc.status)
            return None
        message_id = str(posted["id"])
        if row.kind == board.KIND:
            try:
                await self._pin(tenant, row.channel_id, message_id)
            except _NotNow:
                # The board is posted: keep its id, so the next tick checks the pin (verify)
                # rather than post another board.
                await self._record(tenant, row, message_id, _hash(body), None, verify=True)
                raise
        return message_id

    async def _pin(self, tenant: str, channel_id: str, message_id: str) -> None:
        try:
            await self._send(tenant, "PUT", f"/channels/{channel_id}/pins/{message_id}")
        except RestError as exc:  # no right to pin: the setup check names the fix
            log.warning("pinning the board in %s failed: %s", channel_id, exc.status)

    async def _record(
        self,
        tenant: str,
        row: _Row,
        message_id: str | None,
        shown_hash: str | None,
        edited_at: datetime | None,
        *,
        keep_version: bool = False,
        verify: bool = False,
    ) -> None:
        """What was shown, as of the version read: a change recorded meanwhile stays due."""
        async with self._d.db.tenant(tenant) as conn:
            await conn.execute(
                "UPDATE bot_posts SET message_id = $1, shown_hash = $2,"
                " edited_at = coalesce($3, edited_at), verify = $8,"
                " shown_version = CASE WHEN $4 THEN shown_version ELSE $5 END"
                " WHERE kind = $6 AND key = $7",
                message_id,
                shown_hash,
                edited_at,
                keep_version,
                row.version,
                row.kind,
                row.key,
                verify,
            )

    async def run(self, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> None:
        while True:
            await sleep(TICK_S)
            await self.tick()

    def start(self) -> None:
        self._task = asyncio.create_task(self.run())

    async def close(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None
