"""Settings client, per tenant: read through admin's internal path, follow
admin.settings.changed (contracts/admin.md, Settings).

A person writes settings on admin's API. The module writes only `write`: some of its own keys,
for settings its contract makes the same values as something it stores, so that writing either
way changes both.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from .admin import AdminClient
from .bus import Event
from .service import ServiceIdentity
from .tenant import require_tenant, tenant_scope

log = logging.getLogger("canccu.kit.settings")

SettingValue = str | int | float | bool | list[str | int | float | bool]
OnChange = Callable[[list[str]], Awaitable[None]]


class SettingsClient:
    """Each tenant's settings of one module, loaded on first use and kept until they change.

    The read is the module's own (`/internal/admin/settings/{module}?tenant_id=`, signed), since
    a module reads for the tenant it serves, not on a person's behalf.
    """

    def __init__(
        self,
        admin: AdminClient,
        module: str,
        *,
        service: ServiceIdentity,
        on_change: OnChange | None = None,
    ) -> None:
        self._admin = admin
        self.module = module
        self._service = service
        self._on_change = on_change
        self._cache: dict[str, tuple[int, dict[str, SettingValue]]] = {}
        # A tenant's first read in flight, so concurrent first requests ask admin once.
        self._loading: dict[str, asyncio.Task[None]] = {}

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

    async def ensure(self) -> None:
        """Load the current tenant's settings unless they are cached; callers share one read."""
        tenant = require_tenant()
        if tenant in self._cache:
            return
        task = self._loading.get(tenant)
        if task is None:
            task = asyncio.ensure_future(self.load(tenant))
            self._loading[tenant] = task
            task.add_done_callback(lambda _: self._loading.pop(tenant, None))
        await asyncio.shield(task)

    @property
    def settings_version(self) -> int:
        return self._cache.get(require_tenant(), (0, {}))[0]

    @property
    def values(self) -> dict[str, SettingValue]:
        return dict(self._cache.get(require_tenant(), (0, {}))[1])

    def get(self, key: str, default: SettingValue | None = None) -> SettingValue | None:
        return self._cache.get(require_tenant(), (0, {}))[1].get(key, default)

    async def write(self, values: dict[str, SettingValue], *, actor_user_id: str) -> None:
        """Set some of the current tenant's keys (`PATCH /internal/admin/settings/{module}`), at
        the version this client last read. A stale version raises AdminError `version_conflict`:
        the caller reloads and decides again, since its values came from the old settings."""
        tenant = require_tenant()
        await self.ensure()
        response = await self._admin.request(
            "PATCH",
            f"/internal/admin/settings/{self.module}",
            params={"tenant_id": tenant},
            json={
                "settings_version": self._cache[tenant][0],
                "values": values,
                "actor_user_id": actor_user_id,
            },
            headers=self._service.headers("admin"),
        )
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
