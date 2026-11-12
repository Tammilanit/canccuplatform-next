"""The inverse of a page action, collected inside its write (plan issue-187 D12), so it records
exactly what the write changed. undo.py stores and applies it.

Each step names the item at the revision the write left it: an undo that finds another revision
would overwrite someone's later change, so it refuses instead.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .store import to_json


@dataclass
class Inverse:
    steps: list[dict[str, Any]] = field(default_factory=list)

    def restore(
        self,
        before: Any,
        after: Any,
        columns: list[str],
        minutes: int | None = None,
        announce: bool = True,
    ) -> None:
        """Set `columns` back to their values in `before`; with `minutes`, it undoes a delay and
        is told as the opposite delay. The undo of a quiet change is quiet too (`announce`)."""
        self.steps.append(
            {
                "op": "restore",
                "item_id": after["id"],
                "revision": after["revision"],
                "values": {c: to_json(before[c]) for c in columns},
                "minutes": minutes,
                "announce": announce,
            }
        )

    def remove(self, after: Any) -> None:
        self.steps.append({"op": "remove", "item_id": after["id"], "revision": after["revision"]})

    def add_again(self, after: Any) -> None:
        """Cancelling is final (contracts/agenda.md), so a cancel is undone by a new item."""
        self.steps.append(
            {"op": "add_again", "item_id": after["id"], "revision": after["revision"]}
        )
