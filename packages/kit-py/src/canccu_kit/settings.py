"""Settings client, per tenant: read through admin's internal path, follow
admin.settings.changed, write with settings_version (contracts/admin.md, Settings)."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from .admin import AdminClient
from .bus import Event
from .errors import VersionConflict
from .service import ServiceIdentity
from .tenant import require_tenant, tenant_scope

log = logging.getLogger("canccu.kit.settings")

SettingValue = str | int | float | bool | list[str | int | float | bool]
OnChange = Callable[[list[str]], Awaitable[None]]


class SettingsClient:
    """Each tenant's settings of one module, loaded on first use and kept until they change.

    The read is the module's own (`/internal/admin/settings/{module}?tenant_id=`, signed), since
    a module reads for the tenant it serves, not on a person's behalf; a write is a person's and
    goes through the API with their session.
    """

    def __init__(
        self,
        admin: AdminClient,
        module: str,
        *,
        service: ServiceIdentity,
        session_id: str | None = None,
        on_change: OnChange | None = None,
    ) -> None:
        self._admin = admin
        self.module = module
        self._service = service
        self._session_id = session_id
        self._on_change = on_change
        self._cache: dict[str, tuple[int, dict[str, SettingValue]]] = {}

    def _apply(self, tenant: str, body: dict[str, Any]) -> None:
        self._cache[tenant] = (int(body["settings_version"]), dict(body["values"]))

    async def load(self, tenant: str | None = None) -> None:
        """Read one tenant's settings (by default the current tenant's)."""
        tenant = require_tenant() if tenant is None else tenant
        response = await self._admin.request(
            "GET",
            f"/internal/admin/settings/{self.module}",
            params={"tenant_id": tenant},
            headers=self._service.headers("admin"),
        )
        self._admin.raise_for_error(response)
        self._apply(tenant, response.json())

    async def start(self) -> None:
        await self.load()

    async def ensure(self) -> None:
        """Load the current tenant's settings unless they are cached."""
        if require_tenant() not in self._cache:
            await self.load()

    @property
    def settings_version(self) -> int:
        return self._cache.get(require_tenant(), (0, {}))[0]

    @property
    def values(self) -> dict[str, SettingValue]:
        return dict(self._cache.get(require_tenant(), (0, {}))[1])

    def get(self, key: str, default: SettingValue | None = None) -> SettingValue | None:
        return self._cache.get(require_tenant(), (0, {}))[1].get(key, default)

    async def write(
        self, values: dict[str, SettingValue], *, session_id: str | None = None
    ) -> None:
        """Replace the current tenant's values; raises VersionConflict if they changed since
        they were read."""
        tenant = require_tenant()
        response = await self._admin.request(
            "PUT",
            f"/api/admin/settings/{self.module}",
            session_id=session_id or self._session_id,
            json={"settings_version": self.settings_version, "values": values},
        )
        if response.status_code == 409:
            raise VersionConflict("settings changed since they were read; read again and retry")
        self._admin.raise_for_error(response)
        self._apply(tenant, response.json())

    async def handle_event(self, event: Event) -> None:
        """Feed admin's tenant events here; re-reads a cached tenant on a newer change."""
        tenant = event.tenant
        if (
            event.type != "admin.settings.changed"
            or event.data.get("module") != self.module
            or tenant is None
            or tenant not in self._cache
        ):
            return
        new_version = event.data.get("settings_version")
        if isinstance(new_version, int) and new_version <= self._cache[tenant][0]:
            return
        await self.load(tenant)
        if self._on_change is not None:
            keys = event.data.get("keys")
            changed = [k for k in keys if isinstance(k, str)] if isinstance(keys, list) else []
            with tenant_scope(tenant):
                await self._on_change(changed)
