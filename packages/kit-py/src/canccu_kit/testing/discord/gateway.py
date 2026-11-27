"""The fake gateway: hello, identify, heartbeats, dispatches, resume, and the close codes a bot
must handle. The session logic runs on any `Transport`; in-process tests get a memory pair from
`connect`, the container (`server.py`) adapts a websocket."""

from __future__ import annotations

import asyncio
import json
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from .model import FakeApplication, FakeGuild, Intents

BUFFER = 1000
"""Dispatches a session keeps for a resume; Discord keeps a similar window."""

EVENT_INTENTS = {
    "GUILD_CREATE": Intents.GUILDS,
    "GUILD_UPDATE": Intents.GUILDS,
    "GUILD_DELETE": Intents.GUILDS,
    "GUILD_ROLE_CREATE": Intents.GUILDS,
    "GUILD_ROLE_UPDATE": Intents.GUILDS,
    "GUILD_ROLE_DELETE": Intents.GUILDS,
    "CHANNEL_CREATE": Intents.GUILDS,
    "CHANNEL_UPDATE": Intents.GUILDS,
    "CHANNEL_DELETE": Intents.GUILDS,
    "GUILD_MEMBER_ADD": Intents.GUILD_MEMBERS,
    "GUILD_MEMBER_UPDATE": Intents.GUILD_MEMBERS,
    "GUILD_MEMBER_REMOVE": Intents.GUILD_MEMBERS,
    "VOICE_STATE_UPDATE": Intents.GUILD_VOICE_STATES,
    "PRESENCE_UPDATE": Intents.GUILD_PRESENCES,
    "MESSAGE_CREATE": Intents.GUILD_MESSAGES,
    "MESSAGE_UPDATE": Intents.GUILD_MESSAGES,
    "MESSAGE_DELETE": Intents.GUILD_MESSAGES,
}
"""The intent a dispatch needs; one not listed (INTERACTION_CREATE) reaches every session."""


class GatewayClosed(Exception):
    """The other side closed the connection with this code."""

    def __init__(self, code: int, reason: str = "") -> None:
        super().__init__(f"gateway closed {code} {reason}".strip())
        self.code = code
        self.reason = reason


class Transport(Protocol):
    async def send(self, payload: dict[str, Any]) -> None: ...

    async def recv(self) -> dict[str, Any]:
        """The next payload; raises GatewayClosed once the connection is closed."""
        ...

    async def close(self, code: int = 1000, reason: str = "") -> None: ...


@dataclass
class _Close:
    code: int
    reason: str


class MemoryTransport:
    """One end of an in-memory connection. Payloads go through JSON, as on the wire."""

    def __init__(self, inbox: asyncio.Queue[Any], outbox: asyncio.Queue[Any]) -> None:
        self._inbox = inbox
        self._outbox = outbox
        self.closed: _Close | None = None

    async def send(self, payload: dict[str, Any]) -> None:
        if self.closed is not None:
            raise GatewayClosed(self.closed.code, self.closed.reason)
        await self._outbox.put(json.loads(json.dumps(payload)))

    async def recv(self) -> dict[str, Any]:
        if self.closed is not None and self._inbox.empty():
            raise GatewayClosed(self.closed.code, self.closed.reason)
        item = await self._inbox.get()
        if isinstance(item, _Close):
            self.closed = item
            raise GatewayClosed(item.code, item.reason)
        return dict(item)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        if self.closed is not None:
            return
        self.closed = _Close(code, reason)
        await self._outbox.put(_Close(code, reason))
        await self._inbox.put(_Close(code, reason))  # ends this side's own pending recv


def memory_pair() -> tuple[MemoryTransport, MemoryTransport]:
    a: asyncio.Queue[Any] = asyncio.Queue()
    b: asyncio.Queue[Any] = asyncio.Queue()
    return MemoryTransport(a, b), MemoryTransport(b, a)


def payload(op: int, d: Any, s: int | None = None, t: str | None = None) -> dict[str, Any]:
    return {"op": op, "d": d, "s": s, "t": t}


@dataclass
class Session:
    id: str
    application_id: str
    intents: int
    shard: list[int]
    seq: int = 0
    buffer: list[dict[str, Any]] = field(default_factory=list)
    conn: Transport | None = None


@dataclass
class FakeGateway:
    applications: Callable[[], dict[str, FakeApplication]]
    guilds: Callable[[], dict[str, FakeGuild]]
    url: str
    heartbeat_interval_ms: int = 41250
    sessions: dict[str, Session] = field(default_factory=dict)
    sent: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    """Every payload sent to a bot, with its application id: the transcript's gateway side."""
    _tasks: set[asyncio.Task[None]] = field(default_factory=set)

    async def connect(self, url: str) -> MemoryTransport:
        """A new in-process connection, served by this gateway; `url` is what the bot dialled."""
        del url
        client, server = memory_pair()
        task = asyncio.create_task(self.serve(server))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return client

    def sessions_of(self, application_id: str) -> int:
        """Sessions of an application with a live connection."""
        return sum(
            1
            for s in self.sessions.values()
            if s.application_id == application_id and s.conn is not None
        )

    async def serve(self, conn: Transport) -> None:
        await conn.send(payload(10, {"heartbeat_interval": self.heartbeat_interval_ms}))
        session: Session | None = None
        try:
            while True:
                message = await conn.recv()
                op, d = message.get("op"), message.get("d")
                if op == 1:
                    await conn.send(payload(11, None))
                elif op == 2 and isinstance(d, dict):
                    session = await self._identify(conn, d)
                elif op == 6 and isinstance(d, dict):
                    session = await self._resume(conn, d)
        except GatewayClosed:
            pass
        finally:
            if session is not None and session.conn is conn:
                session.conn = None

    async def _identify(self, conn: Transport, d: dict[str, Any]) -> Session | None:
        app = self._app_of(str(d.get("token", "")))
        if app is None:
            await conn.close(4004, "Authentication failed.")
            return None
        intents = int(d.get("intents", 0))
        if intents & Intents.PRIVILEGED & ~app.privileged:
            await conn.close(4014, "Disallowed intent(s).")
            return None
        shard = list(d.get("shard") or [0, 1])
        session = Session(secrets.token_hex(16), app.id, intents, shard, conn=conn)
        self.sessions[session.id] = session
        ours = [g for g in self.guilds().values() if app.id in g.bots]
        await self._send(
            session,
            "READY",
            {
                "v": 10,
                "user": {"id": app.bot_user_id, "username": app.name, "bot": True},
                "guilds": [{"id": g.id, "unavailable": True} for g in ours],
                "session_id": session.id,
                "resume_gateway_url": self.url,
                "shard": shard,
                "application": {"id": app.id},
            },
        )
        for guild in ours:
            await self._send(session, "GUILD_CREATE", guild.as_payload())
        return session

    async def _resume(self, conn: Transport, d: dict[str, Any]) -> Session | None:
        session = self.sessions.get(str(d.get("session_id", "")))
        app = self._app_of(str(d.get("token", "")))
        if session is None or app is None or app.id != session.application_id:
            await self._raw(conn, None, payload(9, False))
            return None
        session.conn = conn
        after = int(d.get("seq") or 0)
        for missed in session.buffer:
            if missed["s"] > after:
                await self._raw(conn, session.application_id, missed)
        await self._send(session, "RESUMED", {})
        return session

    async def dispatch(
        self, application_id: str, event: str, data: dict[str, Any], *, guild_id: str | None = None
    ) -> int:
        """Send a dispatch to every session of the application whose intents take it; kept for a
        resume on a session that is away. Answers how many live connections got it."""
        del guild_id  # one shard: every guild is on every session
        need = EVENT_INTENTS.get(event, Intents.NONE)
        sent = 0
        for session in list(self.sessions.values()):
            if session.application_id != application_id or (need and not session.intents & need):
                continue
            if await self._send(session, event, data):
                sent += 1
        return sent

    async def disconnect(self, application_id: str, *, code: int = 4000) -> None:
        """Close the application's live connections; their sessions stay for a resume."""
        for session in self.sessions.values():
            if session.application_id == application_id and session.conn is not None:
                conn, session.conn = session.conn, None
                await conn.close(code, "fake disconnect")

    async def request_reconnect(self, application_id: str) -> None:
        await self._to_live(application_id, payload(7, None))

    async def invalidate(self, application_id: str, *, resumable: bool) -> None:
        await self._to_live(application_id, payload(9, resumable))
        if not resumable:
            for sid in [s.id for s in self.sessions.values() if s.application_id == application_id]:
                del self.sessions[sid]

    async def _to_live(self, application_id: str, message: dict[str, Any]) -> None:
        for session in self.sessions.values():
            if session.application_id == application_id and session.conn is not None:
                await self._raw(session.conn, application_id, message)

    async def _send(self, session: Session, event: str, data: dict[str, Any]) -> bool:
        session.seq += 1
        message = payload(0, data, session.seq, event)
        session.buffer = [*session.buffer[-(BUFFER - 1) :], message]
        if session.conn is None:
            return False
        try:
            await self._raw(session.conn, session.application_id, message)
        except GatewayClosed:
            session.conn = None
            return False
        return True

    async def _raw(
        self, conn: Transport, application_id: str | None, message: dict[str, Any]
    ) -> None:
        self.sent.append((application_id or "", message))
        await conn.send(message)

    def _app_of(self, token: str) -> FakeApplication | None:
        return next((a for a in self.applications().values() if a.token == token), None)
