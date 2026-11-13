"""Settings and profile per tenant: cross-tenant leak tests (0013 items 8 and 18).

Each probe seeds and reads the way a user does, on the tenant's own hostname; the kit's
`assert_tenant_isolation` fails when one tenant reads the other's marker, or its own is missing.
"""

from __future__ import annotations

import io
import json
import shutil
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import yaml
from canccu_kit import Bus, Health, NoTenant, ServiceIdentity, tenant_scope
from canccu_kit.rights import Session
from canccu_kit.testing import MemoryStreamStore, assert_tenant_isolation
from conftest import SERVICE_KEY, SIGNIN_HOST, StoreProbe, fake_resolver

from canccu_admin.app import create_app
from canccu_admin.auth import Auth
from canccu_admin.auth_memory import MemoryAuthStore
from canccu_admin.db import MemoryStore
from canccu_admin.declarations import load_declarations
from canccu_admin.health import HealthWatch
from canccu_admin.profile import make_validator
from canccu_admin.service import Service

ROOT = Path(__file__).resolve().parents[3]
HOSTS = {"leak-a": "a.example.org", "leak-b": "b.example.org"}
EVERY_RIGHT = frozenset(
    {"admin.settings.read", "admin.settings.write", "admin.profile.read", "admin.profile.write"}
)


async def authorize(cookie: str | None, right: str) -> Session:
    return Session("u_1", "Tester", EVERY_RIGHT, datetime.now(UTC) + timedelta(hours=1))


class Env:
    def __init__(self, tmp_path: Path) -> None:
        self.files = tmp_path
        self.streams = MemoryStreamStore()
        self.store = MemoryStore()
        self.service = Service(
            self.store,
            Bus(self.streams, "admin"),
            make_validator(ROOT / "contracts/profile.schema.json"),
            tmp_path,
            load_declarations(Path(__file__).parents[1] / "declarations"),
        )
        auth = Auth(MemoryAuthStore(), self.service.bus, None, None)
        self.app = create_app(
            self.service,
            HealthWatch(Health("admin", "dev", {}), {}),
            authorize,
            auth,
            fake_resolver({host: tenant for tenant, host in HOSTS.items()}),
            identity=ServiceIdentity("admin", SERVICE_KEY),
        )

    def client(self, host: str) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app),
            base_url=f"http://{host}",
            cookies={"canccu_session": "s"},
        )

    def event_dir(self, tenant: str) -> Path:
        return self.files / tenant / "admin" / "event"

    def seed_event_dir(self, tenant: str, name: str) -> None:
        target = self.event_dir(tenant)
        shutil.copytree(ROOT / "events/demo", target)
        document = yaml.safe_load((target / "profile.yaml").read_text())
        (target / "profile.yaml").write_text(yaml.safe_dump({**document, "name": name}))


@pytest.fixture
def env(tmp_path: Path) -> Env:
    return Env(tmp_path)


def profile_zip(name: str) -> bytes:
    document = yaml.safe_load((ROOT / "events/demo/profile.yaml").read_text())
    document = {**document, "name": name, "logos": {}, "sounds": {}}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("profile.yaml", yaml.safe_dump(document))
    return buffer.getvalue()


class Probe:
    def __init__(self, env: Env) -> None:
        self.env = env

    async def seed(self, tenant: str, marker: str) -> None:
        raise NotImplementedError

    async def read(self, tenant: str) -> object:
        raise NotImplementedError


class SettingsApi(Probe):
    async def seed(self, tenant: str, marker: str) -> None:
        async with self.env.client(HOSTS[tenant]) as c:
            r = await c.put(
                "/api/admin/settings/screen",
                json={"settings_version": 0, "values": {"title": marker}},
            )
            assert r.status_code == 200, r.text

    async def read(self, tenant: str) -> object:
        async with self.env.client(HOSTS[tenant]) as c:
            return (await c.get("/api/admin/settings/screen")).json()


class SettingsPage(Probe):
    async def seed(self, tenant: str, marker: str) -> None:
        async with self.env.client(HOSTS[tenant]) as c:
            form = {"settings_version": "0", "timezone": marker, "language": "en"}
            r = await c.post("/settings/admin", data=form)
            assert r.status_code == 303, r.text

    async def read(self, tenant: str) -> object:
        async with self.env.client(HOSTS[tenant]) as c:
            return (await c.get("/settings/admin")).text


class ProfileApi(Probe):
    """Import on one host, export on the same: the record, its settings and its files."""

    async def seed(self, tenant: str, marker: str) -> None:
        async with self.env.client(HOSTS[tenant]) as c:
            r = await c.put("/api/admin/profile", content=profile_zip(marker))
            assert r.status_code == 200, r.text

    async def read(self, tenant: str) -> object:
        async with self.env.client(HOSTS[tenant]) as c:
            r = await c.get("/api/admin/profile")
        assert r.status_code == 200, r.text
        return zipfile.ZipFile(io.BytesIO(r.content)).read("profile.yaml").decode()


class ProfilePages(Probe):
    """Load from the tenant's own event folder, save back into it."""

    async def seed(self, tenant: str, marker: str) -> None:
        self.env.seed_event_dir(tenant, marker)
        async with self.env.client(HOSTS[tenant]) as c:
            r = await c.post("/profile/load")
            assert r.status_code == 303, r.text

    async def read(self, tenant: str) -> object:
        (self.env.event_dir(tenant) / "profile.yaml").unlink()
        async with self.env.client(HOSTS[tenant]) as c:
            r = await c.post("/profile/save")
        assert r.status_code == 303, r.text
        return (self.env.event_dir(tenant) / "profile.yaml").read_text()


@pytest.mark.parametrize("probe", [SettingsApi, SettingsPage, ProfileApi, ProfilePages])
async def test_no_tenant_reads_another_tenants_data(env: Env, probe: type[Probe]) -> None:
    await assert_tenant_isolation(probe(env))


async def test_memory_store_keeps_tenants_apart() -> None:
    await assert_tenant_isolation(StoreProbe(MemoryStore()))


async def test_store_refuses_work_without_a_tenant() -> None:
    store = MemoryStore()
    with pytest.raises(NoTenant):
        await store.get_settings("screen")
    with pytest.raises(NoTenant):
        await store.set_profile({"name": "x"})


async def test_events_go_to_the_tenants_own_stream(env: Env) -> None:
    async with env.client(HOSTS["leak-a"]) as c:
        r = await c.put(
            "/api/admin/settings/admin", json={"settings_version": 0, "values": {"language": "fi"}}
        )
        assert r.status_code == 200, r.text
        assert (await c.put("/api/admin/profile", content=profile_zip("A"))).status_code == 200
    assert {call.stream for call in env.streams.calls} == {"t:leak-a:events:admin"}
    envelopes = [json.loads(call.fields["event"]) for call in env.streams.calls]
    assert {e["tenant"] for e in envelopes} == {"leak-a"}
    assert {"admin.settings.changed", "admin.profile.loaded"} <= {e["type"] for e in envelopes}


async def test_profile_files_stay_in_the_tenants_own_folder(env: Env) -> None:
    async with env.client(HOSTS["leak-a"]) as c:
        assert (await c.put("/api/admin/profile", content=profile_zip("A"))).status_code == 200
    assert (env.event_dir("leak-a") / "profile.yaml").is_file()
    assert not env.event_dir("leak-b").exists()
    assert sorted(p.name for p in env.files.iterdir()) == ["leak-a"]


@pytest.mark.parametrize(
    "path", ["/api/admin/settings/admin", "/api/admin/profile", "/settings", "/profile"]
)
async def test_tenant_paths_answer_404_on_an_unknown_or_platform_host(env: Env, path: str) -> None:
    for host in ("unknown.example.org", SIGNIN_HOST, "admin:8080"):
        async with env.client(host) as c:
            r = await c.get(path)
        assert r.status_code == 404, (host, path, r.text)
        assert r.json() == {"error": {"code": "not_found", "message": "Not found."}}


async def test_platform_paths_need_no_tenant(env: Env) -> None:
    """Modules ask admin for sessions on its internal host; health is outside resolution."""
    async with env.client("admin:8080") as c:
        assert (await c.get("/health")).status_code == 200
        r = await c.get("/api/admin/session")
        assert r.status_code == 401 and r.json()["error"]["code"] == "not_signed_in"


async def test_settings_version_counts_per_tenant(env: Env) -> None:
    body = {"settings_version": 0, "values": {"language": "fi"}}
    for host in HOSTS.values():
        async with env.client(host) as c:
            r = await c.put("/api/admin/settings/admin", json=body)
            assert r.status_code == 200 and r.json()["settings_version"] == 1, r.text
    with tenant_scope("leak-a"):
        assert (await env.store.get_settings("admin"))[0] == 1
