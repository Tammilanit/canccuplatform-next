"""Settings, profile and health logic behind the API and the pages."""

from __future__ import annotations

import asyncio
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from canccu_kit import Bus, KitError
from jsonschema import Draft202012Validator

from . import profile as prof
from .db import Store
from .declarations import Setting, check_values

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class BadSettings(KitError):
    status = 400
    code = "settings_invalid"


class NoProfile(KitError):
    status = 409
    code = "no_profile"


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
        event_dir: Path,
        declarations: dict[str, list[Setting]],
        health_targets: dict[str, str],
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self.store = store
        self.bus = bus
        self.validator = validator
        self.event_dir = event_dir
        self.declarations = declarations
        self.health_targets = health_targets
        self._http = http or httpx.AsyncClient(timeout=2.0)

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

    async def save_profile(self, actor: str) -> dict[str, Any]:
        """Write the current profile into the event folder."""
        document = await self._document()
        await asyncio.to_thread(prof.write_profile_dir, self.event_dir, document, None)
        await self.bus.publish(
            "admin.profile.saved",
            {
                "profile_name": document["name"],
                "schema_version": document["schema_version"],
                "actor_user_id": actor,
            },
            version=1,
        )
        return {"name": document["name"], "schema_version": document["schema_version"]}

    async def load_profile(self, actor: str, directory: Path | None = None) -> dict[str, Any]:
        """Read the profile from the event folder (or `directory`) and apply it."""
        source = directory or self.event_dir
        loaded = await asyncio.to_thread(prof.read_profile_dir, source, self.validator)
        document = loaded.document
        for module, values in document.get("settings", {}).items():
            problem = check_values(self.declarations.get(module, []), values)
            if problem:
                raise prof.ProfileInvalid(f"settings/{module}: {problem}")
        record = {k: v for k, v in document.items() if k != "settings"}
        await self.store.set_profile(record)
        for module, values in document.get("settings", {}).items():
            version, _ = await self.store.get_settings(module)
            await self.put_settings(module, version, values, actor)
        await self.bus.publish(
            "admin.profile.loaded",
            {
                "profile_name": document["name"],
                "schema_version": document["schema_version"],
                "actor_user_id": actor,
            },
            version=1,
        )
        result: dict[str, Any] = {
            "name": document["name"],
            "schema_version": document["schema_version"],
            "warnings": loaded.warnings,
        }
        if loaded.upgraded_from is not None:
            result["upgraded_from"] = loaded.upgraded_from
        return result

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
            await self.load_profile(actor, staging)
            await asyncio.to_thread(self._replace_event_dir, staging)
        result: dict[str, Any] = {
            "name": loaded.document["name"],
            "schema_version": loaded.document["schema_version"],
        }
        if loaded.upgraded_from is not None:
            result["upgraded_from"] = loaded.upgraded_from
        return result

    def _replace_event_dir(self, staging: Path) -> None:
        self.event_dir.mkdir(parents=True, exist_ok=True)
        for child in self.event_dir.iterdir():
            shutil.rmtree(child) if child.is_dir() else child.unlink()
        for child in staging.iterdir():
            shutil.move(str(child), self.event_dir / child.name)

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
