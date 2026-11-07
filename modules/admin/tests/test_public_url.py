"""CANCCU_PUBLIC_URL is normalised before it is compared with a browser's Origin (issue #142)."""

from __future__ import annotations

import pytest
from conftest import World

from canccu_admin.auth import Auth, normalize_public_url
from canccu_admin.main import public_url


@pytest.mark.parametrize(
    ("raw", "normal"),
    [
        ("HTTPS://Admin.Example.TEST:443/", "https://admin.example.test"),
        ("http://Admin.example.test:80", "http://admin.example.test"),
        ("http://admin.example.test:8080/sub/", "http://admin.example.test:8080/sub"),
        ("https://admin.example.test:80", "https://admin.example.test:80"),
        ("http://[2001:DB8::1]:80/", "http://[2001:db8::1]"),
        ("http://192.0.2.10", "http://192.0.2.10"),
    ],
)
def test_public_url_is_normalised(raw: str, normal: str) -> None:
    assert normalize_public_url(raw) == normal


@pytest.mark.parametrize(
    "raw",
    [
        "ftp://admin.example.test",
        "admin.example.test",
        "https://",
        "https://admin.example.test:99999",
        "https://user@admin.example.test",
        "https://admin.example.test/?x=1",
        "https://admin.example.test/#top",
    ],
)
def test_bad_public_url_is_refused_at_start(raw: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CANCCU_PUBLIC_URL", raw)
    with pytest.raises(SystemExit, match="CANCCU_PUBLIC_URL"):
        public_url()


def test_start_normalises_the_public_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CANCCU_PUBLIC_URL", " HTTPS://Admin.Example.TEST:443/ ")
    assert public_url() == "https://admin.example.test"
    monkeypatch.setenv("CANCCU_PUBLIC_URL", "")
    assert public_url() is None


def test_auth_compares_origins_with_the_normalised_url(world: World) -> None:
    auth = Auth(world.store, world.auth.bus, "HTTPS://Admin.Example.TEST:443/", None)
    assert auth.public_origin == "https://admin.example.test"
    assert auth.secure_cookies
