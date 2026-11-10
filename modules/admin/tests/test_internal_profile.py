"""`GET /internal/admin/profile/theme` and `/profile/logo`: theming reads the profile's theme and
main logo for revision 0, signed with its service identity (contracts/admin.md, Profile)."""

from __future__ import annotations

import hashlib
import io
import shutil
import zipfile
from pathlib import Path
from typing import Any

import pytest
import yaml
from canccu_kit import ServiceIdentity, tenant_scope
from conftest import ROOT, SERVICE_KEY, World

THEME = "/internal/admin/profile/theme"
LOGO = "/internal/admin/profile/logo"


def signed(caller: str = "theming") -> dict[str, str]:
    return ServiceIdentity(caller, SERVICE_KEY).headers("admin")


async def load_demo(world: World) -> Path:
    with tenant_scope("demo"):
        event = world.service.event_dir
        shutil.copytree(ROOT / "events/demo", event)
        await world.service.load_profile("u_1")
    return event


async def test_theming_reads_the_theme_and_the_logo_whose_hash_it_names(world: World) -> None:
    event = await load_demo(world)
    logo = (event / "assets/logo.svg").read_bytes()
    want_theme = yaml.safe_load((ROOT / "events/demo/profile.yaml").read_text())["theme"]
    theme = await world.internal.get(THEME, params={"tenant_id": "demo"}, headers=signed())
    file = await world.internal.get(LOGO, params={"tenant_id": "demo"}, headers=signed())
    sha = hashlib.sha256(logo).hexdigest()
    assert theme.status_code == 200
    assert theme.json() == {"theme": want_theme, "logo_main": {"sha256": sha, "bytes": len(logo)}}
    assert file.status_code == 200 and file.content == logo
    assert file.headers["etag"] == f'"{sha}"'


async def test_no_profile_answers_empty_and_the_logo_404(world: World) -> None:
    await load_demo(world)
    theme = await world.internal.get(THEME, params={"tenant_id": "other"}, headers=signed())
    file = await world.internal.get(LOGO, params={"tenant_id": "other"}, headers=signed())
    assert theme.status_code == 200 and theme.json() == {"theme": {}, "logo_main": None}
    assert (file.status_code, file.json()["error"]["code"]) == (404, "not_found")


async def test_unknown_tenant_404_and_bad_tenant_400(world: World) -> None:
    for path in (THEME, LOGO):
        unknown = await world.internal.get(path, params={"tenant_id": "nope"}, headers=signed())
        bad = await world.internal.get(path, params={"tenant_id": "Demo!"}, headers=signed())
        missing = await world.internal.get(path, headers=signed())
        assert (unknown.status_code, unknown.json()["error"]["code"]) == (404, "not_found")
        assert (bad.status_code, missing.status_code) == (400, 400)


async def test_only_theming_and_only_signed(world: World) -> None:
    await load_demo(world)
    query = {"tenant_id": "demo"}
    for path in (THEME, LOGO):
        unsigned = await world.internal.get(path, params=query)
        another = await world.internal.get(path, params=query, headers=signed("screen"))
        assert unsigned.status_code == 401
        assert (another.status_code, another.json()["error"]["code"]) == (403, "service_forbidden")


async def test_through_the_edge_it_answers_no_theme(world: World) -> None:
    await load_demo(world)
    query = {"tenant_id": "demo"}
    api = await world.client.get(f"/api{THEME}", params=query)
    page = await world.client.get(f"/admin{THEME}", params=query)
    assert api.status_code == 404
    assert page.status_code == 401 and "theme" not in page.json()


def demo_zip_with_logo(logo: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.write(ROOT / "events/demo/profile.yaml", "profile.yaml")
        for path in sorted((ROOT / "events/demo/assets").rglob("*")):
            if path.is_file():
                name = path.relative_to(ROOT / "events/demo").as_posix()
                z.writestr(name, logo if name == "assets/logo.svg" else path.read_bytes())
    return buffer.getvalue()


async def test_an_import_stores_the_new_logo_before_it_announces_the_load(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    await load_demo(world)
    new_logo = b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    seen: list[Any] = []
    publish = world.service.bus.publish

    async def spy(type: str, *args: Any, **kwargs: Any) -> None:
        if type == "admin.profile.loaded":
            seen.append((await world.service.profile_theme())["logo_main"])
        await publish(type, *args, **kwargs)

    monkeypatch.setattr(world.service.bus, "publish", spy)
    with tenant_scope("demo"):
        await world.service.import_zip(demo_zip_with_logo(new_logo), "u_1")
    assert seen == [{"sha256": hashlib.sha256(new_logo).hexdigest(), "bytes": len(new_logo)}]
