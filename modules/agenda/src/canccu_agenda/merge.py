"""Re-applying a stale edit from the pages (plan issue-187 D13).

Someone may change an item while an organiser has its form open. The API answers such an edit
409 `version_conflict`, as the contract says; the page instead re-applies it on the current
revision when none of the organiser's changes touch a field changed since. A field the organiser
left as it was is not their change, so the other person's value stays. Knowing what the organiser
saw needs every revision since in the change log; without it, nothing is merged.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from zoneinfo import ZoneInfo

from . import store
from .deps import Deps
from .items import edit_values
from .web import local_input


@dataclass
class Rebased:
    fields: dict[str, Any]
    """What to send at the current revision."""
    complete: bool
    """Whether the log holds every revision since the one the form was read at."""
    clash: list[str] = field(default_factory=list)
    """The organiser's changes to fields someone else changed since."""
    log: list[Any] = field(default_factory=list)
    """The changes since, for the page."""


def _same(key: str, posted: Any, seen: Any, tz: ZoneInfo) -> bool:
    if key in ("starts_at", "ends_at"):
        # As the form shows them: to the minute, in the event's time zone.
        return local_input(posted, tz) == local_input(seen, tz)
    return edit_values({key: posted}) == edit_values({key: seen})


async def rebase(
    d: Deps, row: Any, sent_revision: int, fields: dict[str, Any], tz: ZoneInfo
) -> Rebased:
    if sent_revision > row["revision"]:  # only a hand-made form: nothing to merge against
        return Rebased(fields, complete=False)
    async with d.db.tenant() as conn:
        log = await store.changes(conn, row["id"], after=sent_revision)
    log = [r for r in log if r["action"] == "changed"]
    if [r["revision"] for r in log] != list(range(sent_revision + 1, row["revision"] + 1)):
        return Rebased(fields, complete=False)
    seen: dict[str, Any] = {}  # each changed field as the form showed it
    for entry in log:
        old = json.loads(entry["old"])
        for key in entry["fields"]:
            seen.setdefault(key, old.get(key))
    out: dict[str, Any] = {}
    clash = []
    for key, value in fields.items():
        if key not in seen:
            out[key] = value
        elif not _same(key, value, seen[key], tz) and not _same(
            key, value, store.to_json(row[key]), tz
        ):
            # A change to what the other person also set is no clash: the item has it already.
            clash.append(key)
    return Rebased(out, complete=True, clash=clash, log=log)
