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
        await settings.ensure()
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


async def test_concurrent_first_loads_share_one_read() -> None:
    import asyncio

    from canccu_kit import AdminClient

    stored, seen = Stored(demo=(2, {"a": 1})), []

    async def slow(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        await asyncio.sleep(0.01)  # the read is in flight while the others ask
        return stored(request)

    http = httpx.AsyncClient(transport=httpx.MockTransport(slow), base_url="http://admin")
    settings = SettingsClient(
        AdminClient("http://admin", http), "screen", service=ServiceIdentity("screen", KEY)
    )
    with tenant_scope("demo"):
        await asyncio.gather(settings.ensure(), settings.ensure(), settings.ensure())
        await settings.ensure()
        assert settings.get("a") == 1
    assert len(seen) == 1


def test_has_no_tenantless_start(admin: FakeAdmin) -> None:
    assert not hasattr(client(admin), "start")


async def test_a_module_writes_some_of_its_own_settings_at_the_version_it_read(
    admin: FakeAdmin,
) -> None:
    seen: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return json_response(
                200, {"module": "screen", "settings_version": 2, "values": {"a": 1, "b": 2}}
            )
        assert request.method == "PATCH"
        assert request.url.path == "/internal/admin/settings/screen"
        assert request.url.params["tenant_id"] == "demo"
        assert ADMIN.verify(request.headers[SERVICE_HEADER]) == "screen"
        body = json.loads(request.content)
        seen.append(body)
        if body["settings_version"] != 2:
            return json_response(409, {"error": {"code": "version_conflict", "message": "x"}})
        values = {"a": 1, "b": 2, **body["values"]}
        return json_response(200, {"module": "screen", "settings_version": 3, "values": values})

    admin.handler = handler
    settings = client(admin)
    with tenant_scope("demo"):
        await settings.write({"b": 5}, actor_user_id="u_org")  # reads first
        assert seen == [{"settings_version": 2, "values": {"b": 5}, "actor_user_id": "u_org"}]
        # The answer is the new state: no re-read needed.
        assert (settings.settings_version, settings.values) == (3, {"a": 1, "b": 5})
        with pytest.raises(AdminError) as info:
            await settings.write({"b": 6}, actor_user_id="u_org")
    assert (info.value.status, info.value.code) == (409, "version_conflict")
    with pytest.raises(NoTenant):
        await settings.write({"b": 1}, actor_user_id="u")


async def test_other_errors_keep_admin_code(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(
        403, {"error": {"code": "service_forbidden", "message": "no"}}
    )
    with pytest.raises(AdminError) as info:
        await client(admin).load("demo")
    assert (info.value.status, info.value.code) == (403, "service_forbidden")
