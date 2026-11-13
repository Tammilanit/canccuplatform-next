"""The Event profile page (docs/design/mockups.html, sheet 4): what is loaded, Download, and the two
ways to replace it, each asking first."""

from __future__ import annotations

import io
import re
import shutil
import zipfile
from pathlib import Path

import pytest
from canccu_kit import tenant_scope
from conftest import ROOT, World, owner_and_member


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
