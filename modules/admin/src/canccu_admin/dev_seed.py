"""The demo event's content on the dev server (issue #709): `setup/deploy` runs
`python -m canccu_admin dev-seed` after each deploy in dev mode. It imports events/demo's profile
and assets into the demo event, the same import as `PUT /api/admin/profile`, so the dev server
shows what the demo stack shows.

It loads only into an event with no profile, or again after the demo profile changed while the
event still holds only what the seed put there. A profile someone loaded or uploaded, or a
setting changed after the seed's load, keeps it out: the seed never wipes work made by hand.
`--force` (resetting the demo event, docs/operations/dev-server.md) loads it all the same."""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

from canccu_kit import DEMO_TENANT, tenant_file, tenant_scope

from .service import Service

# The loader recorded as `loaded_by`: no user id looks like it (admin's are `u_…`).
SEED_ACTOR = "dev-seed"
PARTS = ("profile.yaml", "assets")
# Beside the event folder, not in it: an import replaces the whole event folder.
MARK = "dev-seed.sha256"

LOADED = "loaded the demo profile into the demo event"
UP_TO_DATE = "the demo event holds the current demo profile; nothing changed"
HAND_MADE = (
    "the demo event's profile or settings were changed by hand; nothing changed"
    " (reset the demo event to load the demo profile again)"
)


class Refused(Exception):
    """Nothing was changed; the message says why."""


def digest(source: Path) -> str:
    """One hash of the profile and every asset, by path and content."""
    h = hashlib.sha256()
    for part in PARTS:
        root = source / part
        files = [root] if root.is_file() else sorted(p for p in root.rglob("*") if p.is_file())
        for file in files:
            h.update(file.relative_to(source).as_posix().encode() + b"\0")
            h.update(hashlib.sha256(file.read_bytes()).digest())
    return h.hexdigest()


def _read_mark(mark: Path) -> str | None:
    return mark.read_text().strip() if mark.is_file() else None


def _write_mark(mark: Path, value: str) -> None:
    mark.parent.mkdir(parents=True, exist_ok=True)
    mark.write_text(value + "\n")


async def seed_demo_profile(service: Service, source: Path, version: str, *, force: bool) -> str:
    if version != "dev":
        raise Refused(f"CANCCU_VERSION is {version}, not dev: nothing changed")
    if not (source / "profile.yaml").is_file():
        raise Refused(f"no profile.yaml in {source}: nothing changed")
    want = await asyncio.to_thread(digest, source)
    with tenant_scope(DEMO_TENANT):
        mark = Path(tenant_file("admin", MARK, root=str(service.files_root)))
        if not force:
            loaded = await service.store.profile_loaded()
            if loaded is not None:
                at, by = loaded
                if by != SEED_ACTOR:
                    return HAND_MADE
                if await asyncio.to_thread(_read_mark, mark) == want:
                    return UP_TO_DATE
                # The seed's own writes are recorded before its load, so any later change is
                # someone else's.
                newest = await service.store.recent_changes(1)
                if newest and newest[0].changed_at > at:
                    return HAND_MADE
        await service.import_dir(source, PARTS, SEED_ACTOR)
        await asyncio.to_thread(_write_mark, mark, want)
    return LOADED
