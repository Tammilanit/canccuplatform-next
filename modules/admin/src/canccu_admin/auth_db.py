"""Persistence for sign-in: users, roles, sessions, OAuth flows and the first-run code.

Sign-in is not per tenant yet: the central sign-in host (#52) binds each session to one tenant.
Secrets are stored only as SHA-256 hashes (session ids, OAuth states, flow nonces, the first-run
code), so a database dump signs nobody in. The PKCE verifier is stored as is: it is
useless without the authorization code Discord sends to the browser.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

import asyncpg
from canccu_kit import new_id


@dataclass(frozen=True)
class User:
    id: str
    discord_id: str
    name: str
    handle: str | None = None
    """The Discord username, shown beside the display name on People."""


@dataclass(frozen=True)
class Person:
    """A row of People: someone who signed in and was not removed since."""

    user: User
    role: str | None
    last_seen_at: datetime | None


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
    return_path: str | None = None
    """A same-site path the browser goes back to after signing in (auth.safe_return_path)."""


class AuthStore(Protocol):
    async def has_owner(self) -> bool: ...

    async def set_first_run_code(self, code_hash: str, now: datetime) -> bool:
        """Replace the code; False (and nothing stored) when an owner exists."""

    async def first_run_matches(self, code_hash: str) -> bool:
        """The code is the current one, unused, and there is no owner yet."""

    async def save_flow(self, state_hash: str, flow: Flow, now: datetime) -> None: ...

    async def take_flow(self, state_hash: str, now: datetime) -> Flow | None:
        """Remove and return an unexpired flow: each state works once."""

    async def upsert_user(
        self, discord_id: str, name: str, now: datetime, handle: str | None = None
    ) -> User:
        """Signing in: also marks them here now, and brings back someone the owner removed."""

    async def claim_owner(
        self, discord_id: str, name: str, code_hash: str, now: datetime, handle: str | None = None
    ) -> User | None:
        """Atomically: check the code, upsert the user, make them owner, use up the code."""

    async def create_session(
        self, id_hash: str, user_id: str, now: datetime, expires_at: datetime
    ) -> None: ...

    async def get_session(self, id_hash: str) -> SessionRow | None: ...

    async def touch_session(self, id_hash: str, now: datetime) -> None:
        """Also the user's "Last here" on People."""

    async def delete_session(self, id_hash: str) -> None: ...

    async def prune(self, now: datetime, idle_before: datetime) -> None:
        """Drop expired sessions and flows."""

    async def list_users(self) -> list[tuple[User, str | None]]:
        """Everyone who ever signed in, removed people too: history names them."""

    async def people(self) -> list[Person]:
        """Everyone People lists: those not removed, by name."""

    async def remove_user(self, user_id: str, now: datetime) -> None:
        """Ends their sessions, takes their role and hides them from People; never the owner."""

    async def get_role(self, user_id: str) -> tuple[User, str | None] | None: ...

    async def set_role(self, user_id: str, role: str | None, actor: str, now: datetime) -> None:
        """Grant `admin` or remove the role; never touches the owner (the caller checks)."""


def new_user_id() -> str:
    return f"u_{new_id()}"


def _user(row: asyncpg.Record) -> User:
    return User(str(row["id"]), str(row["discord_id"]), str(row["name"]), row["handle"])


class PgAuthStore:
    """Its tables come from migrations/002_auth_tables.sql, run by the migration role."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

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
            " expires_at, return_path) VALUES ($1, $2, $3, $4, $5, $6)",
            state_hash,
            flow.nonce_hash,
            flow.verifier,
            flow.claim_hash,
            flow.expires_at,
            flow.return_path,
        )

    async def take_flow(self, state_hash: str, now: datetime) -> Flow | None:
        row = await self._pool.fetchrow(
            "DELETE FROM admin_sign_in_flows WHERE state_hash = $1"
            " RETURNING nonce_hash, verifier, claim_hash, expires_at, return_path",
            state_hash,
        )
        if row is None or row["expires_at"] <= now:
            return None
        return Flow(
            row["nonce_hash"],
            row["verifier"],
            row["claim_hash"],
            row["expires_at"],
            row["return_path"],
        )

    async def upsert_user(
        self, discord_id: str, name: str, now: datetime, handle: str | None = None
    ) -> User:
        return await self._upsert(self._pool, discord_id, name, now, handle)

    @staticmethod
    async def _upsert(
        conn: asyncpg.Pool | asyncpg.Connection,
        discord_id: str,
        name: str,
        now: datetime,
        handle: str | None,
    ) -> User:
        row = await conn.fetchrow(
            "INSERT INTO admin_users (id, discord_id, name, handle, created_at, last_seen_at)"
            " VALUES ($1, $2, $3, $4, $5, $5)"
            " ON CONFLICT (discord_id) DO UPDATE SET name = EXCLUDED.name,"
            " handle = EXCLUDED.handle, last_seen_at = EXCLUDED.last_seen_at, removed_at = NULL"
            " RETURNING id, discord_id, name, handle",
            new_user_id(),
            discord_id,
            name,
            handle,
            now,
        )
        return _user(row)

    async def claim_owner(
        self, discord_id: str, name: str, code_hash: str, now: datetime, handle: str | None = None
    ) -> User | None:
        async with self._pool.acquire() as conn, conn.transaction():
            # The row lock serialises claims; the one-owner index backs it up.
            code = await conn.fetchrow("SELECT code_hash, used_at FROM admin_first_run FOR UPDATE")
            if code is None or code["code_hash"] != code_hash or code["used_at"] is not None:
                return None
            if await conn.fetchval(OWNER_EXISTS):
                return None
            user = await self._upsert(conn, discord_id, name, now, handle)
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
            "SELECT u.id, u.discord_id, u.name, u.handle, r.role, s.last_seen_at, s.expires_at"
            " FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id"
            " LEFT JOIN admin_roles r ON r.user_id = u.id WHERE s.id_hash = $1",
            id_hash,
        )
        if row is None:
            return None
        return SessionRow(_user(row), row["role"], row["last_seen_at"], row["expires_at"])

    async def touch_session(self, id_hash: str, now: datetime) -> None:
        await self._pool.execute(
            "WITH s AS (UPDATE admin_sessions SET last_seen_at = $2 WHERE id_hash = $1"
            " RETURNING user_id) UPDATE admin_users SET last_seen_at = $2"
            " WHERE id = (SELECT user_id FROM s)",
            id_hash,
            now,
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
            "SELECT u.id, u.discord_id, u.name, u.handle, r.role FROM admin_users u"
            " LEFT JOIN admin_roles r ON r.user_id = u.id ORDER BY lower(u.name), u.id"
        )
        return [(_user(r), r["role"]) for r in rows]

    async def people(self) -> list[Person]:
        rows = await self._pool.fetch(
            "SELECT u.id, u.discord_id, u.name, u.handle, u.last_seen_at, r.role"
            " FROM admin_users u LEFT JOIN admin_roles r ON r.user_id = u.id"
            " WHERE u.removed_at IS NULL ORDER BY lower(u.name), u.id"
        )
        return [Person(_user(r), r["role"], r["last_seen_at"]) for r in rows]

    async def remove_user(self, user_id: str, now: datetime) -> None:
        async with self._pool.acquire() as conn, conn.transaction():
            # The owner's role never changes once set (set_role and claim_owner keep it).
            role = await conn.fetchval("SELECT role FROM admin_roles WHERE user_id = $1", user_id)
            if role == "owner":
                return
            await conn.execute("DELETE FROM admin_roles WHERE user_id = $1", user_id)
            await conn.execute("DELETE FROM admin_sessions WHERE user_id = $1", user_id)
            await conn.execute("UPDATE admin_users SET removed_at = $2 WHERE id = $1", user_id, now)

    async def get_role(self, user_id: str) -> tuple[User, str | None] | None:
        row = await self._pool.fetchrow(
            "SELECT u.id, u.discord_id, u.name, u.handle, r.role FROM admin_users u"
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
