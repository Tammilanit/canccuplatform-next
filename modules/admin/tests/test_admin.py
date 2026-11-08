from __future__ import annotations

import io
import json
import shutil
import zipfile
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import yaml
from canccu_kit import Bus, Health, MissingRight, NotSignedIn, ServiceIdentity, tenant_scope
from canccu_kit.rights import Session
from canccu_kit.testing import MemoryStreamStore
from conftest import SERVICE_KEY, fake_resolver

from canccu_admin.app import create_app
from canccu_admin.auth import Auth
from canccu_admin.auth_db import MemoryAuthStore
from canccu_admin.db import MemoryStore
from canccu_admin.declarations import load_declarations
from canccu_admin.profile import make_validator
from canccu_admin.service import Service

ROOT = Path(__file__).resolve().parents[3]
RIGHTS = {
    "admin.settings.read",
    "admin.settings.write",
    "admin.profile.read",
    "admin.profile.write",
}


async def authorize(cookie: str | None, right: str) -> Session:
    if not cookie:
        raise NotSignedIn("sign in first")
    if right not in RIGHTS:
        raise MissingRight(right)
    return Session("u_1", "Tester", frozenset(RIGHTS), datetime.now(UTC) + timedelta(hours=1))


def hello_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "status": "ok",
            "module": "hello",
            "version": "dev",
            "time": "2026-01-01T00:00:00Z",
            "checks": {},
        },
    )


Parts = tuple[httpx.AsyncClient, Service, MemoryStreamStore, Path]


@pytest.fixture
def parts(tmp_path: Path) -> Parts:
    # The kit's per-tenant files tree: /files/<tenant>/admin/event
    event = tmp_path / "demo/admin/event"
    shutil.copytree(ROOT / "events/demo", event)
    streams = MemoryStreamStore()
    store = MemoryStore()
    service = Service(
        store,
        Bus(streams, "admin"),
        make_validator(ROOT / "contracts/profile.schema.json"),
        tmp_path,
        load_declarations(Path(__file__).parents[1] / "declarations"),
        {"hello": "http://hello/health"},
        httpx.AsyncClient(transport=httpx.MockTransport(hello_handler)),
    )
    health = Health("admin", "dev", {})
    auth = Auth(MemoryAuthStore(), service.bus, None, None)
    app = create_app(
        service,
        health,
        authorize,
        auth,
        fake_resolver({"t": "demo"}),
        identity=ServiceIdentity("admin", SERVICE_KEY),
    )
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t", cookies={"canccu_session": "s"}
    )
    return client, service, streams, event


@pytest.fixture
def demo() -> Iterator[None]:
    """Direct service calls run as a request for the demo tenant would."""
    with tenant_scope("demo"):
        yield


async def test_settings_roundtrip_and_conflict(parts: Parts) -> None:
    client, _, streams, _ = parts
    r = await client.get("/api/admin/settings/admin")
    assert r.json() == {"module": "admin", "settings_version": 0, "values": {}}
    r = await client.put(
        "/api/admin/settings/admin", json={"settings_version": 0, "values": {"language": "fi"}}
    )
    assert r.status_code == 200 and r.json()["settings_version"] == 1
    r = await client.put(
        "/api/admin/settings/admin", json={"settings_version": 0, "values": {"language": "en"}}
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "version_conflict"
    r = await client.put(
        "/api/admin/settings/admin", json={"settings_version": 1, "values": {"language": "xx"}}
    )
    assert r.status_code == 400
    assert [c.stream for c in streams.calls] == ["t:demo:events:admin"]
    assert json.loads(streams.calls[0].fields["event"])["tenant"] == "demo"


async def test_rights_required(parts: Parts) -> None:
    client, *_ = parts
    client.cookies.clear()
    r = await client.get("/api/admin/settings/admin")
    assert r.status_code == 401


async def test_settings_form_generated_and_saved(parts: Parts) -> None:
    client, service, _, _ = parts
    page = await client.get("/settings/admin")
    assert "name=timezone" in page.text and "<option selected>en</option>" in page.text
    r = await client.post(
        "/settings/admin",
        data={"settings_version": "0", "timezone": "Europe/Helsinki", "language": "fi"},
    )
    assert r.status_code == 303
    with tenant_scope("demo"):
        stored = await service.get_settings("admin")
    assert stored["values"] == {
        "timezone": "Europe/Helsinki",
        "language": "fi",
    }


async def test_health_view_lists_hello(parts: Parts) -> None:
    client, *_ = parts
    page = await client.get("/health-view")
    assert "hello" in page.text and "admin" in page.text and "ok" in page.text


async def test_demo_round_trip(parts: Parts, tmp_path: Path, demo: None) -> None:
    _client, service, streams, event = parts
    original = yaml.safe_load((event / "profile.yaml").read_text())
    result = await service.load_profile("u_1")
    assert result["warnings"] == [] and result["name"] == "Demo Event"
    assert (await service.get_settings("screen"))["values"] == {"rotation_seconds": 15}
    (event / "profile.yaml").unlink()
    await service.save_profile("u_1")
    assert yaml.safe_load((event / "profile.yaml").read_text()) == original
    assert (event / "assets/logo.svg").is_file()
    types = [c.fields["event"] for c in streams.calls]
    assert any("admin.profile.loaded" in t for t in types)
    assert any("admin.profile.saved" in t for t in types)


async def test_profile_events_and_results(parts: Parts, demo: None) -> None:
    _client, service, streams, _event = parts
    loaded = await service.load_profile("u_1")
    saved = await service.save_profile("u_1")
    imported = await service.import_zip(await service.export_zip("u_1"), "u_1")
    assert loaded == {"name": "Demo Event", "schema_version": 1, "warnings": []}
    assert saved == imported == {"name": "Demo Event", "schema_version": 1}
    events = [json.loads(c.fields["event"]) for c in streams.calls]
    want = {"profile_name": "Demo Event", "schema_version": 1, "actor_user_id": "u_1"}
    for kind in ("loaded", "saved"):
        datas = [e["data"] for e in events if e["type"] == f"admin.profile.{kind}"]
        assert datas and all(d == want for d in datas)


async def test_load_warns_about_missing_file(parts: Parts, demo: None) -> None:
    _, service, _, event = parts
    (event / "assets/logo.svg").unlink()
    result = await service.load_profile("u_1")
    assert result["warnings"] == ["missing file: assets/logo.svg (named in the profile)"]


async def test_load_rejects_too_new_and_invalid(parts: Parts, demo: None) -> None:
    _client, service, _, event = parts
    doc = yaml.safe_load((event / "profile.yaml").read_text())
    (event / "profile.yaml").write_text(yaml.safe_dump({**doc, "schema_version": 9}))
    with pytest.raises(Exception, match="up to 1") as exc:
        await service.load_profile("u_1")
    assert exc.value.code == "profile_too_new"  # type: ignore[attr-defined]
    (event / "profile.yaml").write_text(yaml.safe_dump({**doc, "bogus": 1}))
    with pytest.raises(Exception) as exc2:
        await service.load_profile("u_1")
    assert exc2.value.code == "profile_invalid"  # type: ignore[attr-defined]


async def test_upgrade_older_version(
    parts: Parts, monkeypatch: pytest.MonkeyPatch, demo: None
) -> None:
    from canccu_admin import profile

    _, service, _, _event = parts
    monkeypatch.setattr(profile, "CURRENT_VERSION", 2)
    monkeypatch.setitem(profile.UPGRADERS, 1, lambda d: dict(d))
    # schema accepts only 1, so a v2 target needs the validator relaxed
    monkeypatch.setattr(service, "validator", type("V", (), {"iter_errors": lambda s, d: []})())
    result = await service.load_profile("u_1")
    assert result["upgraded_from"] == 1 and result["schema_version"] == 2


async def test_zip_export_import(parts: Parts, demo: None) -> None:
    client, service, _, _event = parts
    await service.load_profile("u_1")
    r = await client.get("/api/admin/profile")
    assert r.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert "profile.yaml" in names and "assets/logo.svg" in names
    r = await client.put("/api/admin/profile", content=r.content)
    assert r.status_code == 200 and r.json()["name"] == "Demo Event"
    bad = io.BytesIO()
    with zipfile.ZipFile(bad, "w") as z:
        z.writestr("../evil", "x")
    r = await client.put("/api/admin/profile", content=bad.getvalue())
    assert r.status_code == 400 and r.json()["error"]["code"] == "profile_invalid"
