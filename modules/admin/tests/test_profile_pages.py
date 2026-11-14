"""The Event profile page (docs/design/mockups.html, sheet 4): what is loaded, Download, and the two
ways to replace it, each asking first."""

from __future__ import annotations

import io
import re
import shutil
import zipfile
from pathlib import Path

import pytest
from canccu_kit import VersionConflict, tenant_scope
from conftest import ROOT, World, owner_and_member
from starlette.datastructures import UploadFile

from canccu_admin import profile


@pytest.fixture
def event(world: World) -> Path:
    """The demo event's folder, as the stack seeds it."""
    folder = world.service.files_root / "demo/admin/event"
    shutil.copytree(ROOT / "events/demo", folder)
    return folder


def demo_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path in sorted((ROOT / "events/demo").rglob("*")):
            if path.is_file() and (path.name == "profile.yaml" or "assets" in path.parts):
                archive.write(path, path.relative_to(ROOT / "events/demo").as_posix())
    return buffer.getvalue()


async def test_before_any_load_the_page_offers_to_load(
    world: World, event: Path, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    text = (await world.browser(owner).get("/admin/profile")).text
    assert "Nothing loaded yet" in text and "Download this profile" not in text
    assert "Replace with another profile" in text and "Both ask first." in text
    assert 'href="/admin/profile/load">Load the Demo Event profile…</a>' in text
    assert 'href="/admin/profile/upload">Upload a profile…</a>' in text


async def test_load_asks_first_and_offers_the_current_profile(
    world: World, event: Path, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    browser = world.browser(owner)
    await browser.post("/admin/profile/load", headers={"origin": "https://admin.example.test"})
    text = (await browser.get("/admin/profile/load")).text
    assert "Load the Demo Event profile again?" in text
    assert "<dt>Replaced</dt><dd>Every setting and the theme, with the profile&#x27;s.</dd>" in text
    assert "<dt>Kept</dt><dd>The run of show, people and their roles.</dd>" in text
    assert 'href="/api/admin/profile" download="profile.zip">' in text
    assert 'canccu-i--download" aria-hidden="true"></span>Download current profile</a>' in text
    assert 'canccu-button--secondary" href="/admin/profile">Cancel</a>' in text
    assert '<form method=post action="/admin/profile/load"' in text
    assert ">Replace settings and look</button>" in text
    # Asking replaces nothing.
    with tenant_scope("demo"):
        assert (await world.service.store.get_settings("screen"))[0] == 1


async def test_after_a_load_the_page_says_what_was_loaded_when_and_by_whom(
    world: World, event: Path, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    browser = world.browser(owner)
    r = await browser.post("/admin/profile/load", headers={"origin": "https://admin.example.test"})
    assert r.status_code == 303
    text = (await browser.get(r.headers["location"])).text
    assert re.search(r"Demo Event · today \d\d:\d\d by Olli", text)
    assert "<dt>Modules</dt><dd>9</dd>" in text and "<dt>Time zone</dt><dd>UTC</dd>" in text
    assert 'href="/api/admin/profile" download="profile.zip">' in text
    assert "Download this profile</a>" in text
    assert 'href="/admin/profile/load">Load the Demo Event profile again…</a>' in text


async def test_upload_asks_first_then_loads_the_file(
    world: World, event: Path, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    browser = world.browser(owner)
    text = (await browser.get("/admin/profile/upload")).text
    assert "Upload a profile?" in text and "<dt>Kept</dt>" in text
    assert 'enctype="multipart/form-data"' in text and "type=file name=profile" in text
    r = await browser.post(
        "/admin/profile/upload",
        files={"profile": ("profile.zip", demo_zip(), "application/zip")},
        headers={"origin": "https://admin.example.test"},
    )
    assert r.status_code == 303 and "message=Loaded+Demo+Event" in r.headers["location"]
    with tenant_scope("demo"):
        assert (await world.service.store.get_settings("pizza"))[1] == {"ordering_open": False}


async def test_a_file_that_is_no_profile_is_refused_in_words(
    world: World, event: Path, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    r = await world.browser(owner).post(
        "/admin/profile/upload",
        files={"profile": ("notes.zip", b"not a zip", "application/zip")},
        headers={"origin": "https://admin.example.test"},
    )
    assert r.status_code == 400
    assert "Couldn&#x27;t load that file" in r.text and "type=file name=profile" in r.text
    with tenant_scope("demo"):
        assert await world.service.store.get_profile() is None


async def test_replacing_needs_the_right_to_write_the_profile(
    world: World, event: Path, caplog: pytest.LogCaptureFixture
) -> None:
    _, member = await owner_and_member(world, caplog)
    # Without a role the sign-in page says what to do (#453, sheet 3 "No role yet").
    for path in ("/admin/profile/load", "/admin/profile/upload"):
        r = await world.browser(member).get(path)
        assert r.status_code == 303 and r.headers["location"] == "/admin/sign-in"


async def test_a_broken_folder_profile_says_why_and_upload_stays(
    world: World, event: Path, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    browser = world.browser(owner)
    for broken, reason in ((b"name: [", "not valid YAML"), (b"name: \xff\xfe", "not UTF-8")):
        (event / "profile.yaml").write_bytes(broken)
        r = await browser.get("/admin/profile")
        assert r.status_code == 200
        assert "The profile in the event folder can&#x27;t be loaded" in r.text and reason in r.text
        assert "holds no profile" not in r.text and 'href="/admin/profile/load"' not in r.text
        assert 'href="/admin/profile/upload">Upload a profile…</a>' in r.text
        # The question answers the same problem instead of "no profile".
        r = await browser.get("/admin/profile/load")
        assert r.status_code == 400 and reason in r.text


ORIGIN = {"origin": "https://admin.example.test"}


def rename(event: Path, name: str) -> None:
    file = event / "profile.yaml"
    file.write_text(file.read_text().replace("name: Demo Event", f"name: {name}", 1))


async def test_again_only_for_the_profile_that_is_loaded(
    world: World, event: Path, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    browser = world.browser(owner)
    await browser.post("/admin/profile/load", headers=ORIGIN)
    # The folder now holds another profile: loading it is no "again".
    rename(event, "Other Event")
    text = (await browser.get("/admin/profile")).text
    assert 'href="/admin/profile/load">Load the Other Event profile…</a>' in text
    text = (await browser.get("/admin/profile/load")).text
    assert "Load the Other Event profile?" in text and "again" not in text


async def test_saved_names_the_profile_whatever_its_characters(
    world: World, event: Path, caplog: pytest.LogCaptureFixture
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    browser = world.browser(owner)
    rename(event, '"Rock & Roll #1 + more"')
    await browser.post("/admin/profile/load", headers=ORIGIN)
    r = await browser.post("/admin/profile/save", headers=ORIGIN)
    assert r.status_code == 303
    text = (await browser.get(r.headers["location"])).text
    assert "Saved Rock &amp; Roll #1 + more" in text


async def test_the_loaded_card_tells_time_in_the_events_one_time_zone(
    world: World, event: Path, caplog: pytest.LogCaptureFixture
) -> None:
    # The event's time zone (contracts/tenants.md) is the one source: the card's "Time zone"
    # and its "loaded … by" moment never disagree.
    owner, _ = await owner_and_member(world, caplog)
    browser = world.browser(owner)
    await browser.post("/admin/profile/load", headers=ORIGIN)
    world.event["time_zone"] = "Europe/Helsinki"
    with tenant_scope("demo"):
        assert (await world.service.store.get_settings("admin"))[1].get("timezone") in (
            None,
            "UTC",
        )
    text = (await browser.get("/admin/profile")).text
    assert "<dt>Time zone</dt><dd>Europe/Helsinki</dd>" in text


async def test_an_upload_too_large_is_refused_before_it_is_read(
    world: World, event: Path, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    monkeypatch.setattr(profile, "MAX_ZIP_BYTES", 100)
    reads: list[int] = []
    real_read = UploadFile.read

    async def read(self: UploadFile, size: int = -1) -> bytes:
        reads.append(size)
        return await real_read(self, size)

    monkeypatch.setattr(UploadFile, "read", read)
    r = await world.browser(owner).post(
        "/admin/profile/upload",
        files={"profile": ("profile.zip", demo_zip(), "application/zip")},
        headers=ORIGIN,
    )
    assert r.status_code == 400 and "too large" in r.text
    assert reads == []
    with tenant_scope("demo"):
        assert await world.service.store.get_profile() is None


async def test_a_load_is_stamped_only_once_every_setting_is_written(
    world: World, event: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = world.service.put_settings
    calls: list[str] = []

    async def put_settings(module: str, *args: object) -> object:
        calls.append(module)
        if len(calls) == 2:
            raise VersionConflict("someone saved meanwhile")
        return await real(module, *args)  # type: ignore[arg-type]

    monkeypatch.setattr(world.service, "put_settings", put_settings)
    with tenant_scope("demo"), pytest.raises(VersionConflict):
        await world.service.load_profile("u_1")
    with tenant_scope("demo"):
        assert await world.service.store.profile_loaded() is None


def _stored_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("profile.yaml", "schema_version: 1\nname: Demo Event\n")
    return buffer.getvalue()


def _bad_crc() -> bytes:
    data = bytearray(_stored_zip())
    at = data.index(b"name: Demo")
    data[at] ^= 0xFF
    return bytes(data)


def _unknown_method() -> bytes:
    data = bytearray(_stored_zip())
    for header, offset in ((b"PK\x03\x04", 8), (b"PK\x01\x02", 10)):
        at = data.index(header) + offset
        data[at : at + 2] = (99).to_bytes(2, "little")
    return bytes(data)


@pytest.mark.parametrize("data", [_bad_crc(), _unknown_method()], ids=["crc", "method"])
def test_a_zip_that_cannot_be_read_is_an_invalid_profile(data: bytes, tmp_path: Path) -> None:
    with pytest.raises(profile.ProfileInvalid):
        profile.unpack_zip(data, tmp_path)
