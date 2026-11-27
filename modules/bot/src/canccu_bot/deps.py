"""What the handlers share."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from canccu_kit import SecretBox

from .config import SharedApp
from .db import Db
from .status import StatusBoard


@dataclass
class Deps:
    db: Db
    rights: Any
    """The kit's RightsChecker, or a test's fake."""
    board: StatusBoard
    shared: SharedApp | None
    secrets: SecretBox
