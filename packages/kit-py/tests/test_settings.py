from __future__ import annotations

import json

import httpx
import pytest

from canccu_kit import AdminError, SettingsClient, VersionConflict
from canccu_kit.bus import Event

from .conftest import FakeAdmin, json_response


def changed(module: str, version: int, keys: list[str] | None = None) -> Event:
    return Event(
        id=f"e{version}",
        type="admin.settings.changed",
        version=1,
        time="2026-01-01T12:00:00Z",
        source="admin",
        data={
            "module": module,
            "keys": keys or [],
            "settings_version": version,
            "actor_user_id": "u",
        },
    )


class Stored:
    def __init__(self, version: int = 0, values: dict[str, object] | None = None) -> None:
        self.version = version
        self.values = values or {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/admin/settings/screen"
        if request.method == "PUT":
            body = json.loads(request.content)
            if body["settings_version"] != self.version:
                return json_response(
                    409, {"error": {"code": "version_conflict", "message": "stale"}}
                )
            self.version += 1
            self.values = body["values"]
        return json_response(
            200, {"module": "screen", "settings_version": self.version, "values": self.values}
        )


async def test_start_reads_version_zero(admin: FakeAdmin) -> None:
    admin.handler = Stored()
    settings = SettingsClient(admin.client(), "screen")
    await settings.start()
    assert (settings.settings_version, settings.values) == (0, {})


async def test_change_event_rereads_only_for_own_newer_version(admin: FakeAdmin) -> None:
    stored = Stored(4, {"rotation_seconds": 10})
    admin.handler = stored
    seen: list[list[str]] = []

    async def on_change(keys: list[str]) -> None:
        seen.append(keys)

    settings = SettingsClient(admin.client(), "screen", on_change=on_change)
    await settings.start()
    assert len(admin.requests) == 1

    await settings.handle_event(changed("tournament", 9))
    await settings.handle_event(changed("screen", 4))
    assert len(admin.requests) == 1

    stored.version, stored.values = 5, {"rotation_seconds": 20}
    await settings.handle_event(changed("screen", 5, ["rotation_seconds"]))
    assert len(admin.requests) == 2
    assert settings.get("rotation_seconds") == 20
    assert seen == [["rotation_seconds"]]


async def test_write_sends_held_version_and_maps_409(admin: FakeAdmin) -> None:
    stored = Stored(2, {"a": 1})
    admin.handler = stored
    settings = SettingsClient(admin.client(), "screen")
    await settings.start()

    await settings.write({"a": 2}, session_id="s1")
    sent = json.loads(admin.requests[-1].content)
    assert sent == {"settings_version": 2, "values": {"a": 2}}
    assert admin.requests[-1].headers["cookie"] == "canccu_session=s1"
    assert settings.settings_version == 3

    stored.version = 7  # someone else wrote meanwhile
    with pytest.raises(VersionConflict) as info:
        await settings.write({"a": 3})
    assert info.value.status == 409
    assert info.value.to_body()["error"]["code"] == "version_conflict"


async def test_other_errors_keep_admin_code(admin: FakeAdmin) -> None:
    admin.handler = lambda r: json_response(
        403, {"error": {"code": "missing_right", "message": "no"}}
    )
    with pytest.raises(AdminError) as info:
        await SettingsClient(admin.client(), "screen").start()
    assert (info.value.status, info.value.code) == (403, "missing_right")
