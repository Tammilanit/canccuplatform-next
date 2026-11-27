"""What the handlers share."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from canccu_kit import Outbox, SecretBox

from .config import Hosts, SharedApp
from .db import Db
from .discord_api import DiscordApi
from .lease import KeyStore
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
    now: Callable[[], datetime] = field(default=lambda: datetime.now(UTC))
