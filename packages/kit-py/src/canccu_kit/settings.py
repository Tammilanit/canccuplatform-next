"""Settings client: read at start, follow admin.settings.changed, write with settings_version."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from .admin import AdminClient
from .bus import Event
from .errors import VersionConflict

log = logging.getLogger("canccu.kit.settings")

SettingValue = str | int | float | bool | list[str | int | float | bool]
OnChange = Callable[[list[str]], Awaitable[None]]


class SettingsClient:
    def __init__(
        self,
        admin: AdminClient,
        module: str,
        *,
        session_id: str | None = None,
        on_change: OnChange | None = None,
    ) -> None:
        self._admin = admin
        self.module = module
        self._session_id = session_id
        self._on_change = on_change
        self.settings_version = 0
        self.values: dict[str, SettingValue] = {}

    @property
    def _path(self) -> str:
        return f"/api/admin/settings/{self.module}"

    def _apply(self, body: dict[str, Any]) -> None:
        self.settings_version = int(body["settings_version"])
        self.values = dict(body["values"])

    async def start(self) -> None:
        """Read the settings once; call at module start."""
        await self.refresh()

    async def refresh(self) -> None:
        response = await self._admin.request("GET", self._path, session_id=self._session_id)
        self._admin.raise_for_error(response)
        self._apply(response.json())

    def get(self, key: str, default: SettingValue | None = None) -> SettingValue | None:
        return self.values.get(key, default)

    async def write(
        self, values: dict[str, SettingValue], *, session_id: str | None = None
    ) -> None:
        """Replace the values; raises VersionConflict if they changed since they were read."""
        response = await self._admin.request(
            "PUT",
            self._path,
            session_id=session_id or self._session_id,
            json={"settings_version": self.settings_version, "values": values},
        )
        if response.status_code == 409:
            raise VersionConflict("settings changed since they were read; read again and retry")
        self._admin.raise_for_error(response)
        self._apply(response.json())

    async def handle_event(self, event: Event) -> None:
        """Feed events from `events:admin`; re-reads on a newer change for this module."""
        if event.type != "admin.settings.changed" or event.data.get("module") != self.module:
            return
        new_version = event.data.get("settings_version")
        if isinstance(new_version, int) and new_version <= self.settings_version:
            return
        await self.refresh()
        if self._on_change is not None:
            keys = event.data.get("keys")
            changed = [k for k in keys if isinstance(k, str)] if isinstance(keys, list) else []
            await self._on_change(changed)
