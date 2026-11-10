"""Everything a route needs, built once in main.py (or by the tests) and kept on `app.state`."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

from canccu_kit import Bus, Outbox
from canccu_kit.rights import Session
from starlette.requests import Request

from .db import Db


class Rights(Protocol):
    async def session(self, cookie_header: str | None) -> Session: ...


class Settings(Protocol):
    """The kit's SettingsClient, for the tenant in scope."""

    async def ensure(self) -> None: ...

    def get(self, key: str, default: Any = None) -> Any: ...


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Deps:
    db: Db
    bus: Bus
    rights: Rights
    settings: Settings
    outbox: Outbox
    now: Callable[[], datetime] = field(default=utc_now)


def deps(request: Request) -> Deps:
    value: Deps = request.app.state.deps
    return value
