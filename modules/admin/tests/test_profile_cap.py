"""A profile upload too large is refused before its body is parsed or held whole: on Content-Length
when it says so, else by counting the body as it arrives."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from canccu_kit import tenant_scope
from conftest import World, owner_and_member
from starlette.requests import Request

from canccu_admin import profile

ORIGIN = {"origin": "https://admin.example.test"}
BOUNDARY = "canccu-test-boundary"
FORM = {**ORIGIN, "content-type": f"multipart/form-data; boundary={BOUNDARY}"}


def multipart(size: int) -> bytes:
    return (
        (
            f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="profile"; '
            f'filename="profile.zip"\r\nContent-Type: application/zip\r\n\r\n'
        ).encode()
        + b"x" * size
        + f"\r\n--{BOUNDARY}--\r\n".encode()
    )


async def chunked(body: bytes) -> AsyncIterator[bytes]:
    """Sent without a Content-Length, so only counting can tell its size."""
    for start in range(0, len(body), 16384):
        yield body[start : start + 16384]


@pytest.fixture
def parsed(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Each time a request's form or whole body is read: the cap comes first."""
    calls: list[str] = []
    real_form, real_body = Request.form, Request.body

    def form(self: Request, **kwargs: object) -> object:
        calls.append("form")
        return real_form(self, **kwargs)  # type: ignore[arg-type]

    async def body(self: Request) -> bytes:
        calls.append("body")
        return await real_body(self)

    monkeypatch.setattr(Request, "form", form)
    monkeypatch.setattr(Request, "body", body)
    monkeypatch.setattr(profile, "MAX_ZIP_BYTES", 100)
    return calls


@pytest.mark.parametrize("stream", [False, True], ids=["content-length", "counted"])
async def test_an_upload_too_large_is_refused_before_the_form_is_parsed(
    world: World, caplog: pytest.LogCaptureFixture, parsed: list[str], stream: bool
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    parsed.clear()  # signing in posts forms of its own
    # Past the file's cap plus the 64 KiB the form's own parts may take.
    body = multipart(100 + 70_000)
    r = await world.browser(owner).post(
        "/admin/profile/upload", content=chunked(body) if stream else body, headers=FORM
    )
    assert r.status_code == 400 and "too large" in r.text
    assert "Couldn&#x27;t load that file" in r.text
    assert parsed == []
    with tenant_scope("demo"):
        assert await world.service.store.get_profile() is None


async def test_a_form_within_the_cap_is_still_parsed(
    world: World, caplog: pytest.LogCaptureFixture, parsed: list[str]
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    parsed.clear()  # signing in posts forms of its own
    # The file is over its own cap, but the form is not: the upload's own check says so.
    r = await world.browser(owner).post(
        "/admin/profile/upload", content=multipart(500), headers=FORM
    )
    assert r.status_code == 400 and "too large" in r.text
    assert parsed == ["form"]


@pytest.mark.parametrize("stream", [False, True], ids=["content-length", "counted"])
async def test_a_profile_put_too_large_is_refused_before_it_is_read_whole(
    world: World, caplog: pytest.LogCaptureFixture, parsed: list[str], stream: bool
) -> None:
    owner, _ = await owner_and_member(world, caplog)
    parsed.clear()  # signing in posts forms of its own
    body = b"x" * 101
    r = await world.browser(owner).put(
        "/api/admin/profile", content=chunked(body) if stream else body, headers=ORIGIN
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "profile_invalid"
    assert "too large" in r.json()["error"]["message"]
    assert parsed == []
