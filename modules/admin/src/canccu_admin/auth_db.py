"""Persistence for sign-in: users, roles, sessions, OAuth flows and the first-run code.

Admin is still single-event: #56 moves users to the tenants module and binds sessions to a
tenant. Secrets are stored only as SHA-256 hashes (session ids, OAuth states, flow nonces, the
first-run code), so a database dump signs nobody in. The PKCE verifier is stored as is: it is
useless without the authorization code Discord sends to the browser.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Protocol

import asyncpg
from canccu_kit import new_id

AUTH_SCHEMA = """
CREATE TABLE IF NOT EXISTS admin_users (
  id text PRIMARY KEY,
  discord_id text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_roles (
  user_id text PRIMARY KEY REFERENCES admin_users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin')),
  granted_at timestamptz NOT NULL,
  granted_by text
);
-- At most one owner, so two concurrent first-run claims cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS admin_roles_one_owner ON admin_roles ((true))
  WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS admin_sessions (
  id_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sign_in_flows (
  state_hash text PRIMARY KEY,
  nonce_hash text NOT NULL,
  verifier text NOT NULL,
  claim_hash text,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_first_run (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by text REFERENCES admin_users (id) ON DELETE SET NULL
);
"""

ROLES = ("owner", "admin")


@dataclass(frozen=True)
class User:
    id: str
    discord_id: str
    name: str


@dataclass(frozen=True)
class SessionRow:
    user: User
    role: str | None
    last_seen_at: datetime
    expires_at: datetime
    """The absolute end; the idle end is computed from last_seen_at."""


@dataclass(frozen=True)
class Flow:
    nonce_hash: str
    verifier: str
    claim_hash: str | None
    """Set when the flow claims ownership with the first-run code."""
    expires_at: datetime


class AuthStore(Protocol):
    async def has_owner(self) -> bool: ...

    async def set_first_run_code(self, code_hash: str, now: datetime) -> bool:
        """Replace the code; False (and nothing stored) when an owner exists."""

    async def first_run_matches(self, code_hash: str) -> bool:
        """The code is the current one, unused, and there is no owner yet."""

    async def save_flow(self, state_hash: str, flow: Flow, now: datetime) -> None: ...

    async def take_flow(self, state_hash: str, now: datetime) -> Flow | None:
        """Remove and return an unexpired flow: each state works once."""

    async def upsert_user(self, discord_id: str, name: str, now: datetime) -> User: ...

    async def claim_owner(
        self, discord_id: str, name: str, code_hash: str, now: datetime
    ) -> User | None:
        """Atomically: check the code, upsert the user, make them owner, use up the code."""

    async def create_session(
        self, id_hash: str, user_id: str, now: datetime, expires_at: datetime
    ) -> None: ...

    async def get_session(self, id_hash: str) -> SessionRow | None: ...

    async def touch_session(self, id_hash: str, now: datetime) -> None: ...

    async def delete_session(self, id_hash: str) -> None: ...

    async def prune(self, now: datetime, idle_before: datetime) -> None:
        """Drop expired sessions and flows."""

    async def list_users(self) -> list[tuple[User, str | None]]: ...

    async def get_role(self, user_id: str) -> tuple[User, str | None] | None: ...

    async def set_role(self, user_id: str, role: str | None, actor: str, now: datetime) -> None:
        """Grant `admin` or remove the role; never touches the owner (the caller checks)."""


def _user_id() -> str:
    return f"u_{new_id()}"


class MemoryAuthStore:
    def __init__(self) -> None:
        self.users: dict[str, User] = {}
        self.roles: dict[str, str] = {}
        self.sessions: dict[str, tuple[str, datetime, datetime]] = {}
        self.flows: dict[str, Flow] = {}
        self.first_run: tuple[str, bool] | None = None

    async def has_owner(self) -> bool:
        return "owner" in self.roles.values()

    async def set_first_run_code(self, code_hash: str, now: datetime) -> bool:
        if await self.has_owner():
            return False
        self.first_run = (code_hash, False)
        return True

    async def first_run_matches(self, code_hash: str) -> bool:
        return not await self.has_owner() and self.first_run == (code_hash, False)

    async def save_flow(self, state_hash: str, flow: Flow, now: datetime) -> None:
        self.flows[state_hash] = flow

    async def take_flow(self, state_hash: str, now: datetime) -> Flow | None:
        flow = self.flows.pop(state_hash, None)
        return flow if flow is not None and flow.expires_at > now else None

    async def upsert_user(self, discord_id: str, name: str, now: datetime) -> User:
        found = next((u for u in self.users.values() if u.discord_id == discord_id), None)
        user = replace(found, name=name) if found else User(_user_id(), discord_id, name)
        self.users[user.id] = user
        return user

    async def claim_owner(
        self, discord_id: str, name: str, code_hash: str, now: datetime
    ) -> User | None:
        if not await self.first_run_matches(code_hash):
            return None
        user = await self.upsert_user(discord_id, name, now)
        self.roles[user.id] = "owner"
        self.first_run = (code_hash, True)
        return user

    async def create_session(
        self, id_hash: str, user_id: str, now: datetime, expires_at: datetime
    ) -> None:
        self.sessions[id_hash] = (user_id, now, expires_at)

    async def get_session(self, id_hash: str) -> SessionRow | None:
        row = self.sessions.get(id_hash)
        if row is None:
            return None
        user_id, last_seen, expires = row
        return SessionRow(self.users[user_id], self.roles.get(user_id), last_seen, expires)

    async def touch_session(self, id_hash: str, now: datetime) -> None:
        user_id, _, expires = self.sessions[id_hash]
        self.sessions[id_hash] = (user_id, now, expires)

    async def delete_session(self, id_hash: str) -> None:
        self.sessions.pop(id_hash, None)

    async def prune(self, now: datetime, idle_before: datetime) -> None:
        self.sessions = {
            k: v for k, v in self.sessions.items() if v[2] > now and v[1] > idle_before
        }
        self.flows = {k: f for k, f in self.flows.items() if f.expires_at > now}

    async def list_users(self) -> list[tuple[User, str | None]]:
        return [(u, self.roles.get(u.id)) for u in sorted(self.users.values(), key=_by_name)]

    async def get_role(self, user_id: str) -> tuple[User, str | None] | None:
        user = self.users.get(user_id)
        return None if user is None else (user, self.roles.get(user_id))

    async def set_role(self, user_id: str, role: str | None, actor: str, now: datetime) -> None:
        if role is None:
            self.roles.pop(user_id, None)
        else:
            self.roles[user_id] = role


def _by_name(user: User) -> str:
    return user.name.lower()


def _user(row: asyncpg.Record) -> User:
    return User(str(row["id"]), str(row["discord_id"]), str(row["name"]))


class PgAuthStore:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    @classmethod
    async def create(cls, pool: asyncpg.Pool) -> PgAuthStore:
        async with pool.acquire() as conn:
            await conn.execute(AUTH_SCHEMA)
        return cls(pool)

    async def has_owner(self) -> bool:
        return bool(await self._pool.fetchval(OWNER_EXISTS))

    async def set_first_run_code(self, code_hash: str, now: datetime) -> bool:
        row = await self._pool.fetchrow(
            "INSERT INTO admin_first_run (id, code_hash, created_at)"
            f" SELECT true, $1, $2 WHERE NOT ({OWNER_EXISTS})"
            " ON CONFLICT (id) DO UPDATE SET code_hash = EXCLUDED.code_hash,"
            " created_at = EXCLUDED.created_at, used_at = NULL, used_by = NULL"
            " RETURNING id",
            code_hash,
            now,
        )
        return row is not None

    async def first_run_matches(self, code_hash: str) -> bool:
        return bool(
            await self._pool.fetchval(
                "SELECT EXISTS (SELECT 1 FROM admin_first_run WHERE code_hash = $1"
                f" AND used_at IS NULL) AND NOT ({OWNER_EXISTS})",
                code_hash,
            )
        )

    async def save_flow(self, state_hash: str, flow: Flow, now: datetime) -> None:
        await self._pool.execute(
            "INSERT INTO admin_sign_in_flows (state_hash, nonce_hash, verifier, claim_hash,"
            " expires_at) VALUES ($1, $2, $3, $4, $5)",
            state_hash,
            flow.nonce_hash,
            flow.verifier,
            flow.claim_hash,
            flow.expires_at,
        )

    async def take_flow(self, state_hash: str, now: datetime) -> Flow | None:
        row = await self._pool.fetchrow(
            "DELETE FROM admin_sign_in_flows WHERE state_hash = $1"
            " RETURNING nonce_hash, verifier, claim_hash, expires_at",
            state_hash,
        )
        if row is None or row["expires_at"] <= now:
            return None
        return Flow(row["nonce_hash"], row["verifier"], row["claim_hash"], row["expires_at"])

    async def upsert_user(self, discord_id: str, name: str, now: datetime) -> User:
        return await self._upsert(self._pool, discord_id, name, now)

    @staticmethod
    async def _upsert(
        conn: asyncpg.Pool | asyncpg.Connection, discord_id: str, name: str, now: datetime
    ) -> User:
        row = await conn.fetchrow(
            "INSERT INTO admin_users (id, discord_id, name, created_at) VALUES ($1, $2, $3, $4)"
            " ON CONFLICT (discord_id) DO UPDATE SET name = EXCLUDED.name"
            " RETURNING id, discord_id, name",
            _user_id(),
            discord_id,
            name,
            now,
        )
        return _user(row)

    async def claim_owner(
        self, discord_id: str, name: str, code_hash: str, now: datetime
    ) -> User | None:
        async with self._pool.acquire() as conn, conn.transaction():
            # The row lock serialises claims; the one-owner index backs it up.
            code = await conn.fetchrow("SELECT code_hash, used_at FROM admin_first_run FOR UPDATE")
            if code is None or code["code_hash"] != code_hash or code["used_at"] is not None:
                return None
            if await conn.fetchval(OWNER_EXISTS):
                return None
            user = await self._upsert(conn, discord_id, name, now)
            await conn.execute(
                "INSERT INTO admin_roles (user_id, role, granted_at) VALUES ($1, 'owner', $2)"
                " ON CONFLICT (user_id) DO UPDATE SET role = 'owner', granted_at = $2,"
                " granted_by = NULL",
                user.id,
                now,
            )
            await conn.execute(
                "UPDATE admin_first_run SET used_at = $1, used_by = $2", now, user.id
            )
            return user

    async def create_session(
        self, id_hash: str, user_id: str, now: datetime, expires_at: datetime
    ) -> None:
        await self._pool.execute(
            "INSERT INTO admin_sessions (id_hash, user_id, created_at, last_seen_at, expires_at)"
            " VALUES ($1, $2, $3, $3, $4)",
            id_hash,
            user_id,
            now,
            expires_at,
        )

    async def get_session(self, id_hash: str) -> SessionRow | None:
        row = await self._pool.fetchrow(
            "SELECT u.id, u.discord_id, u.name, r.role, s.last_seen_at, s.expires_at"
            " FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id"
            " LEFT JOIN admin_roles r ON r.user_id = u.id WHERE s.id_hash = $1",
            id_hash,
        )
        if row is None:
            return None
        return SessionRow(_user(row), row["role"], row["last_seen_at"], row["expires_at"])

    async def touch_session(self, id_hash: str, now: datetime) -> None:
        await self._pool.execute(
            "UPDATE admin_sessions SET last_seen_at = $2 WHERE id_hash = $1", id_hash, now
        )

    async def delete_session(self, id_hash: str) -> None:
        await self._pool.execute("DELETE FROM admin_sessions WHERE id_hash = $1", id_hash)

    async def prune(self, now: datetime, idle_before: datetime) -> None:
        await self._pool.execute(
            "DELETE FROM admin_sessions WHERE expires_at <= $1 OR last_seen_at <= $2",
            now,
            idle_before,
        )
        await self._pool.execute("DELETE FROM admin_sign_in_flows WHERE expires_at <= $1", now)

    async def list_users(self) -> list[tuple[User, str | None]]:
        rows = await self._pool.fetch(
            "SELECT u.id, u.discord_id, u.name, r.role FROM admin_users u"
            " LEFT JOIN admin_roles r ON r.user_id = u.id ORDER BY lower(u.name), u.id"
        )
        return [(_user(r), r["role"]) for r in rows]

    async def get_role(self, user_id: str) -> tuple[User, str | None] | None:
        row = await self._pool.fetchrow(
            "SELECT u.id, u.discord_id, u.name, r.role FROM admin_users u"
            " LEFT JOIN admin_roles r ON r.user_id = u.id WHERE u.id = $1",
            user_id,
        )
        return None if row is None else (_user(row), row["role"])

    async def set_role(self, user_id: str, role: str | None, actor: str, now: datetime) -> None:
        if role is None:
            await self._pool.execute(
                "DELETE FROM admin_roles WHERE user_id = $1 AND role <> 'owner'", user_id
            )
            return
        await self._pool.execute(
            "INSERT INTO admin_roles (user_id, role, granted_at, granted_by)"
            " VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role,"
            " granted_at = EXCLUDED.granted_at, granted_by = EXCLUDED.granted_by"
            " WHERE admin_roles.role <> 'owner'",
            user_id,
            role,
            now,
            actor,
        )


OWNER_EXISTS = "SELECT EXISTS (SELECT 1 FROM admin_roles WHERE role = 'owner')"
