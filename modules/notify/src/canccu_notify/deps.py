"""Everything a route needs, built once in main.py (or by the tests) and kept on `app.state`."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

from canccu_kit import Bus, SecretBox
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
    now: Callable[[], datetime] = field(default=utc_now)


def deps(request: Request) -> Deps:
    value: Deps = request.app.state.deps
    return value
