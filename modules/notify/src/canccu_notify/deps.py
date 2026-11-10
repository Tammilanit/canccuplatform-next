"""Everything a route needs, built once in main.py (or by the tests) and kept on `app.state`."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

from canccu_kit import Bus, Outbox, SecretBox
from canccu_kit.access import TenantContext
from canccu_kit.rights import Session
from starlette.requests import Request

from .db import Db

if TYPE_CHECKING:
    from .push import Pusher


class Rights(Protocol):
    async def session(self, cookie_header: str | None) -> Session: ...


class Settings(Protocol):
    """The kit's SettingsClient, for the tenant in scope."""

    async def ensure(self) -> None: ...

    async def load(self) -> None: ...

    async def write(self, values: dict[str, Any], *, actor_user_id: str) -> None: ...

    def get(self, key: str, default: Any = None) -> Any: ...


class Audit(Protocol):
    """`POST /internal/tenants/audit` (contracts/tenants.md, Audit log)."""

    async def append(
        self, tenant_id: str, actor_user_id: str, action: str, target: dict[str, str]
    ) -> None: ...


class Tenants(Protocol):
    """The kit's lookup of another event by its id (contracts/tenants.md, Another event by its
    id): for internal callers, whose request names no event by its hostname."""

    async def by_id(self, tenant_id: str) -> TenantContext | None: ...


class Agenda(Protocol):
    """`GET /internal/agenda/items?tenant_id=` (contracts/agenda.md, Reading): every item of the
    event. Raises when the agenda cannot answer."""

    async def items(self, tenant_id: str) -> dict[str, Any]: ...


class Users(Protocol):
    """`GET /internal/tenants/users/{user_id}`: the user's Discord id, or None while the tenants
    module does not know the user (or does not serve the read yet, #150)."""

    async def discord_id(self, user_id: str) -> str | None: ...


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Deps:
    db: Db
    bus: Bus
    rights: Rights
    settings: Settings
    audit: Audit
    secrets: SecretBox
    tenants: Tenants
    push: Pusher
    outbox: Outbox
    agenda: Agenda
    users: Users
    now: Callable[[], datetime] = field(default=utc_now)
    check_in_keys: dict[str, bytes | None] = field(default_factory=dict)
    """Each event's opened check-in key, by tenant id: a key never changes once made, only its
    seal does, so the process may keep it. None: the key did not open, and that was logged."""


def deps(request: Request) -> Deps:
    value: Deps = request.app.state.deps
    return value
