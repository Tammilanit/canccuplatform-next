"""What the handlers share."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from canccu_kit import Outbox, SecretBox

from .catalogue import games_catalogue
from .components import ComponentKeys
from .config import Hosts, SharedApp
from .db import Db
from .discord_api import DiscordApi
from .lease import KeyStore
from .privacy import hidden_discord_ids
from .status import StatusBoard


@dataclass
class Deps:
    db: Db
    rights: Any
    """The kit's RightsChecker, or a test's fake."""
    board: StatusBoard
    shared: SharedApp | None
    secrets: SecretBox
    discord: DiscordApi
    outbox: Outbox
    keys: KeyStore
    """Valkey: the bind's single-use states besides the pool's keys."""
    tenants: Any
    """The kit's TenantResolver: another event by its id (`by_id`)."""
    users: Any
    """access.UsersReader, or a test's fake."""
    audit: Any
    """access.TenantsAudit, or a test's fake."""
    hosts: Hosts
    series: Any
    """access.SeriesReader, or a test's fake."""
    now: Callable[[], datetime] = field(default=lambda: datetime.now(UTC))
    commands: tuple[Any, ...] = ()
    """The framework's commands (framework.Command), each under its feature flag."""
    components: ComponentKeys | None = None
    acting: Any = None
    """acting.ActingClient: a command acting in a module as its person."""
    look: Any = None
    """look.EventLook: the event's name and colour."""
    http: Any = None
    """An httpx.AsyncClient for outside providers (providers.py)."""
    hidden: Callable[[str], Awaitable[frozenset[str]]] = hidden_discord_ids
    """privacy.hidden_discord_ids: who every count leaves out."""
    catalogue: Callable[[str], Awaitable[list[dict[str, Any]]]] = games_catalogue
    """catalogue.games_catalogue: the event's games, for the stats' top games."""
