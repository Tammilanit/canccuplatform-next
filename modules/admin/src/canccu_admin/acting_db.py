"""Persistence for acting tokens (contracts/admin.md, The acting token), in Postgres and as a
memory twin for the tests (tests/test_acting_store.py runs both)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

import asyncpg

from .auth_db import User
from .auth_memory import MemoryAuthStore


@dataclass(frozen=True)
class Account:
    user: User
    role: str | None
    removed: bool
    """The owner took them off People: no longer a member of anything (the seam of B11)."""


@dataclass(frozen=True)
class ActingToken:
    tenant_id: str
    user_id: str
    module: str
    expires_at: datetime


class ActingStore(Protocol):
    async def account(
        self, *, discord_id: str | None = None, user_id: str | None = None
    ) -> Account | None:
        """One user by their Discord id or their own id, with their role."""

    async def save(self, token_hash: str, token: ActingToken, now: datetime) -> None:
        """Also drops the tokens that ran out, so the table holds a minute's worth."""

    async def get(self, token_hash: str) -> ActingToken | None: ...


_ACCOUNT = (
    "SELECT u.id, u.discord_id, u.name, u.handle, u.removed_at IS NOT NULL AS removed, r.role"
    " FROM admin_users u LEFT JOIN admin_roles r ON r.user_id = u.id"
)


class PgActingStore:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def account(
        self, *, discord_id: str | None = None, user_id: str | None = None
    ) -> Account | None:
        column, value = ("u.discord_id", discord_id) if discord_id else ("u.id", user_id)
        row = await self._pool.fetchrow(f"{_ACCOUNT} WHERE {column} = $1", value)
        if row is None:
            return None
        user = User(str(row["id"]), str(row["discord_id"]), str(row["name"]), row["handle"])
        return Account(user, row["role"], bool(row["removed"]))

    async def save(self, token_hash: str, token: ActingToken, now: datetime) -> None:
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute("DELETE FROM admin_acting_tokens WHERE expires_at <= $1", now)
            await conn.execute(
                "INSERT INTO admin_acting_tokens"
                " (token_hash, tenant_id, user_id, module, created_at, expires_at)"
                " VALUES ($1, $2, $3, $4, $5, $6)",
                token_hash,
                token.tenant_id,
                token.user_id,
                token.module,
                now,
                token.expires_at,
            )

    async def get(self, token_hash: str) -> ActingToken | None:
        row = await self._pool.fetchrow(
            "SELECT tenant_id, user_id, module, expires_at FROM admin_acting_tokens"
            " WHERE token_hash = $1",
            token_hash,
        )
        if row is None:
            return None
        return ActingToken(row["tenant_id"], row["user_id"], row["module"], row["expires_at"])


@dataclass
class MemoryActingStore:
    auth: MemoryAuthStore
    tokens: dict[str, ActingToken] = field(default_factory=dict)

    async def account(
        self, *, discord_id: str | None = None, user_id: str | None = None
    ) -> Account | None:
        users = self.auth.users.values()
        found = next(
            (u for u in users if (u.discord_id == discord_id if discord_id else u.id == user_id)),
            None,
        )
        if found is None:
            return None
        return Account(found, self.auth.roles.get(found.id), found.id in self.auth.removed)

    async def save(self, token_hash: str, token: ActingToken, now: datetime) -> None:
        self.tokens = {k: t for k, t in self.tokens.items() if t.expires_at > now}
        self.tokens[token_hash] = token

    async def get(self, token_hash: str) -> ActingToken | None:
        return self.tokens.get(token_hash)
