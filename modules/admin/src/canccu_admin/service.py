"""Settings, profile and health logic behind the API and the pages.

Settings and the profile are per tenant: every method that touches them runs for the current
tenant (set by the kit from the request's hostname), reads and writes only that tenant's rows and
event folder, and publishes on that tenant's stream.
"""

from __future__ import annotations

import asyncio
import hashlib
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from canccu_kit import Bus, KitError, tenant_file
from jsonschema import Draft202012Validator

from . import profile as prof
from .db import Store
from .declarations import KEY_RE, Setting, check_values


class BadSettings(KitError):
    status = 400
    code = "settings_invalid"


class NoProfile(KitError):
    status = 409
    code = "no_profile"


def _summary(document: dict[str, Any], upgraded_from: int | None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "name": document["name"],
        "schema_version": document["schema_version"],
    }
    if upgraded_from is not None:
        result["upgraded_from"] = upgraded_from
    return result


def _replace_dir(target: Path, staging: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for child in target.iterdir():
        shutil.rmtree(child) if child.is_dir() else child.unlink()
    for child in staging.iterdir():
        shutil.move(str(child), target / child.name)


@dataclass
class ModuleHealth:
    module: str
    status: str
    version: str = ""
    detail: str = ""


class Service:
    def __init__(
        self,
        store: Store,
        bus: Bus,
        validator: Draft202012Validator,
        files_root: Path,
        declarations: dict[str, list[Setting]],
        health_targets: dict[str, str],
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self.store = store
        self.bus = bus
        self.validator = validator
        self.files_root = files_root
        self.declarations = declarations
        self.health_targets = health_targets
        self._http = http or httpx.AsyncClient(timeout=2.0)

    @property
    def event_dir(self) -> Path:
        """The current tenant's event folder: `<files root>/<tenant>/admin/event`."""
        return Path(tenant_file("admin", "event", root=str(self.files_root)))

    # settings
    async def get_settings(self, module: str) -> dict[str, Any]:
        version, values = await self.store.get_settings(module)
        return {"module": module, "settings_version": version, "values": values}

    async def put_settings(
        self, module: str, expected_version: int, values: dict[str, Any], actor: str
    ) -> dict[str, Any]:
        for key, value in values.items():
            flat = value if isinstance(value, list) else [value]
            if not KEY_RE.match(key) or not all(
                isinstance(v, str | int | float | bool) for v in flat
            ):
                raise BadSettings(f"bad setting {key!r}")
        problem = check_values(self.declarations.get(module, []), values)
        if problem:
            raise BadSettings(problem)
        _, old = await self.store.get_settings(module)
        version = await self.store.put_settings(module, expected_version, values)
        keys = sorted(k for k in old.keys() | values.keys() if old.get(k) != values.get(k))
        await self.bus.publish(
            "admin.settings.changed",
            {"module": module, "keys": keys, "settings_version": version, "actor_user_id": actor},
            version=1,
        )
        return {"module": module, "settings_version": version, "values": values}

    async def patch_settings(
        self, module: str, expected_version: int, values: dict[str, Any], actor: str
    ) -> dict[str, Any]:
        """A module sets some keys of its own settings and keeps the rest (contracts/admin.md,
        Settings); the store's version check still refuses a stale write."""
        _, old = await self.store.get_settings(module)
        return await self.put_settings(module, expected_version, {**old, **values}, actor)

    # profile
    async def _document(self) -> dict[str, Any]:
        record = await self.store.get_profile()
        if record is None:
            raise NoProfile("no profile has been loaded yet")
        document = dict(record)
        settings: dict[str, Any] = {}
        for module in record["modules"]:
            _, values = await self.store.get_settings(module)
            if values:
                settings[module] = values
        if settings:
            document["settings"] = settings
        return document

    async def _publish_profile(self, type: str, document: dict[str, Any], actor: str) -> None:
        await self.bus.publish(
            type,
            {
                "profile_name": document["name"],
                "schema_version": document["schema_version"],
                "actor_user_id": actor,
            },
            version=1,
        )

    async def save_profile(self, actor: str) -> dict[str, Any]:
        """Write the current profile into the event folder."""
        document = await self._document()
        await asyncio.to_thread(prof.write_profile_dir, self.event_dir, document, None)
        await self._publish_profile("admin.profile.saved", document, actor)
        return _summary(document, None)

    async def load_profile(self, actor: str) -> dict[str, Any]:
        """Read the profile from the event folder and apply it."""
        loaded = await asyncio.to_thread(prof.read_profile_dir, self.event_dir, self.validator)
        await self._apply(loaded.document, actor)
        await self._publish_profile("admin.profile.loaded", loaded.document, actor)
        return {**_summary(loaded.document, loaded.upgraded_from), "warnings": loaded.warnings}

    async def _apply(self, document: dict[str, Any], actor: str) -> None:
        for module, values in document.get("settings", {}).items():
            problem = check_values(self.declarations.get(module, []), values)
            if problem:
                raise prof.ProfileInvalid(f"settings/{module}: {problem}")
        record = {k: v for k, v in document.items() if k != "settings"}
        await self.store.set_profile(record)
        for module, values in document.get("settings", {}).items():
            version, _ = await self.store.get_settings(module)
            await self.put_settings(module, version, values, actor)

    async def export_zip(self, actor: str) -> bytes:
        await self.save_profile(actor)
        return await asyncio.to_thread(prof.pack_zip, self.event_dir)

    async def import_zip(self, data: bytes, actor: str) -> dict[str, Any]:
        """Apply a profile zip; every file it names must be in it (contracts/profile.md)."""
        with tempfile.TemporaryDirectory() as tmp:
            staging = Path(tmp)
            await asyncio.to_thread(prof.unpack_zip, data, staging)
            loaded = await asyncio.to_thread(prof.read_profile_dir, staging, self.validator)
            if loaded.warnings:
                raise prof.ProfileInvalid(loaded.warnings[0])
            await self._apply(loaded.document, actor)
            await asyncio.to_thread(_replace_dir, self.event_dir, staging)
        # Only now: theming re-reads the logo on this event, so the new files must be in place.
        await self._publish_profile("admin.profile.loaded", loaded.document, actor)
        return _summary(loaded.document, loaded.upgraded_from)

    # the profile's design, for theming at revision 0
    async def profile_theme(self) -> dict[str, Any]:
        record = await self.store.get_profile() or {}
        logo = await self.profile_logo()
        return {
            "theme": record.get("theme", {}),
            "logo_main": None
            if logo is None
            else {"sha256": hashlib.sha256(logo).hexdigest(), "bytes": len(logo)},
        }

    async def profile_logo(self) -> bytes | None:
        """The file `logos.main` names, from the current tenant's event folder; None without one."""
        record = await self.store.get_profile() or {}
        path = (record.get("logos") or {}).get("main")
        if not isinstance(path, str):
            return None
        event = self.event_dir.resolve()
        file = (event / path).resolve()
        # The schema already refuses `..` and absolute paths; this keeps a stored record honest too.
        if not file.is_relative_to(event) or not file.is_file():
            return None
        return await asyncio.to_thread(file.read_bytes)

    # health view
    async def _probe(self, module: str, url: str) -> ModuleHealth:
        try:
            body = (await self._http.get(url)).json()
            checks = body.get("checks", {})
            bad = [
                f"{n}: {c.get('detail') or c.get('status')}"
                for n, c in checks.items()
                if c.get("status") != "ok"
            ]
            return ModuleHealth(
                module, str(body["status"]), str(body.get("version", "")), "; ".join(bad)
            )
        except Exception as exc:
            return ModuleHealth(module, "down", detail=f"no answer ({type(exc).__name__})")

    async def health_view(self) -> list[ModuleHealth]:
        return list(
            await asyncio.gather(*(self._probe(m, u) for m, u in self.health_targets.items()))
        )
