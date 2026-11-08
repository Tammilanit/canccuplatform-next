from __future__ import annotations

import json

import httpx
import pytest

from canccu_kit import (
    SERVICE_HEADER,
    AdminError,
    NoTenant,
    ServiceIdentity,
    SettingsClient,
    VersionConflict,
    tenant_scope,
)
from canccu_kit.bus import Event

from .conftest import FakeAdmin, json_response

KEY = b"k" * 32
ADMIN = ServiceIdentity("admin", KEY)


def changed(
    module: str, version: int, keys: list[str] | None = None, tenant: str = "demo"
) -> Event:
    return Event(
        id=f"e{version}-{tenant}",
        type="admin.settings.changed",
        version=1,
        time="2026-01-01T12:00:00Z",
        source="admin",
        tenant=tenant,
        data={
            "module": module,
            "keys": keys or [],
            "settings_version": version,
            "actor_user_id": "u",
        },
    )


class Stored:
    """Admin's settings per tenant: the internal read (signed by the module) and the API write."""

    def __init__(self, **tenants: tuple[int, dict[str, object]]) -> None:
        self.tenants = dict(tenants)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            assert request.url.path == "/internal/admin/settings/screen"
            assert ADMIN.verify(request.headers[SERVICE_HEADER]) == "screen"
            tenant = request.url.params["tenant_id"]
        else:
            assert request.url.path == "/api/admin/settings/screen"
            tenant = "demo"
            body = json.loads(request.content)
            version, _ = self.tenants.get(tenant, (0, {}))
            if body["settings_version"] != version:
                return json_response(
                    409, {"error": {"code": "version_conflict", "message": "stale"}}
                )
            self.tenants[tenant] = (version + 1, body["values"])
        version, values = self.tenants.get(tenant, (0, {}))
        return json_response(
            200, {"module": "screen", "settings_version": version, "values": values}
        )


def client(admin: FakeAdmin, **kw: object) -> SettingsClient:
    return SettingsClient(
        admin.client(),
        "screen",
        service=ServiceIdentity("screen", KEY),
        **kw,  # type: ignore[arg-type]
    )


async def test_each_tenant_reads_its_own_settings(admin: FakeAdmin) -> None:
    admin.handler = Stored(demo=(3, {"rotation_seconds": 10}), other=(1, {"rotation_seconds": 30}))
    settings = client(admin)
    with tenant_scope("demo"):
        assert settings.get("rotation_seconds", 5) == 5  # not loaded yet
        await settings.load()
        assert (settings.settings_version, settings.get("rotation_seconds")) == (3, 10)
    with tenant_scope("other"):
        await settings.start()
        assert settings.get("rotation_seconds") == 30
    with tenant_scope("never"):
        assert settings.settings_version == 0


async def test_without_a_tenant_nothing_is_read(admin: FakeAdmin) -> None:
    admin.handler = Stored()
    with pytest.raises(NoTenant):
        await client(admin).load()
    with pytest.raises(NoTenant):
        client(admin).get("x")


async def test_change_event_rereads_only_its_tenant_for_a_newer_version(admin: FakeAdmin) -> None:
    stored = Stored(demo=(4, {"rotation_seconds": 10}), other=(2, {}))
    admin.handler = stored
    seen: list[tuple[str | None, list[str]]] = []

    async def on_change(keys: list[str]) -> None:
        from canccu_kit import current_tenant

        seen.append((current_tenant(), keys))

    settings = client(admin, on_change=on_change)
    await settings.load("demo")
    assert len(admin.requests) == 1

    await settings.handle_event(changed("tournament", 9))
    await settings.handle_event(changed("screen", 4))
    await settings.handle_event(changed("screen", 9, tenant="other"))  # not loaded: skip
    assert len(admin.requests) == 1

    stored.tenants["demo"] = (5, {"rotation_seconds": 20})
    await settings.handle_event(changed("screen", 5, ["rotation_seconds"]))
    assert len(admin.requests) == 2
    with tenant_scope("demo"):
        assert settings.get("rotation_seconds") == 20
    assert seen == [("demo", ["rotation_seconds"])]


async def test_write_sends_held_version_and_maps_409(admin: FakeAdmin) -> None:
    stored = Stored(demo=(2, {"a": 1}))
    admin.handler = stored
    settings = client(admin)
    with tenant_scope("demo"):
        await settings.load()
        await settings.write({"a": 2}, session_id="s1")
        sent = json.loads(admin.requests[-1].content)
        assert sent == {"settings_version": 2, "values": {"a": 2}}
        assert admin.requests[-1].headers["cookie"] == "canccu_session=s1"
        assert settings.settings_version == 3

        stored.tenants["demo"] = (7, {})  # someone else wrote meanwhile
        with pytest.raises(VersionConflict) as info:
            await settings.write({"a": 3})
    assert info.value.status == 409


async def test_other_errors_keep_admin_code(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(
        403, {"error": {"code": "service_forbidden", "message": "no"}}
    )
    with pytest.raises(AdminError) as info:
        await client(admin).load("demo")
    assert (info.value.status, info.value.code) == (403, "service_forbidden")
