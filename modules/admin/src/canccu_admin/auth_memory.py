"""The sign-in store in memory, for the tests: it must behave as PgAuthStore does
(tests/test_auth_store.py runs both)."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime

from .auth_db import Flow, Person, SessionRow, User, new_user_id


class MemoryAuthStore:
    def __init__(self) -> None:
        self.users: dict[str, User] = {}
        self.roles: dict[str, str] = {}
        self.seen: dict[str, datetime] = {}
        self.removed: set[str] = set()
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

    async def upsert_user(
        self, discord_id: str, name: str, now: datetime, handle: str | None = None
    ) -> User:
        found = next((u for u in self.users.values() if u.discord_id == discord_id), None)
        if found:
            user = replace(found, name=name, handle=handle)
        else:
            user = User(new_user_id(), discord_id, name, handle)
        self.users[user.id] = user
        self.seen[user.id] = now
        self.removed.discard(user.id)
        return user

    async def claim_owner(
        self, discord_id: str, name: str, code_hash: str, now: datetime, handle: str | None = None
    ) -> User | None:
        if not await self.first_run_matches(code_hash):
            return None
        user = await self.upsert_user(discord_id, name, now, handle)
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
        self.seen[user_id] = now

    async def delete_session(self, id_hash: str) -> None:
        self.sessions.pop(id_hash, None)

    async def prune(self, now: datetime, idle_before: datetime) -> None:
        self.sessions = {
            k: v for k, v in self.sessions.items() if v[2] > now and v[1] > idle_before
        }
        self.flows = {k: f for k, f in self.flows.items() if f.expires_at > now}

    async def list_users(self) -> list[tuple[User, str | None]]:
        return [(u, self.roles.get(u.id)) for u in sorted(self.users.values(), key=_by_name)]

    async def people(self) -> list[Person]:
        return [
            Person(u, self.roles.get(u.id), self.seen.get(u.id))
            for u in sorted(self.users.values(), key=_by_name)
            if u.id not in self.removed
        ]

    async def remove_user(self, user_id: str, now: datetime) -> None:
        if self.roles.get(user_id) == "owner":
            return
        self.roles.pop(user_id, None)
        self.sessions = {k: v for k, v in self.sessions.items() if v[0] != user_id}
        if user_id in self.users:
            self.removed.add(user_id)

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
