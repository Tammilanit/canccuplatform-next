"""Which admin paths run for a tenant. IP mode itself is the kit's: it asks the tenants module's
`GET /internal/tenants/ip-mode` (kit-py tests/test_resolve.py)."""

from __future__ import annotations

import pytest

from canccu_admin.main import tenant_resolver
from canccu_admin.tenancy import is_tenant_path


def test_ip_mode_follows_the_tenants_modules_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    from canccu_kit import ServiceIdentity

    monkeypatch.setenv("CANCCU_TENANTS_URL", "http://tenants:8080")
    monkeypatch.setenv("CANCCU_IP_MODE", "demo")
    identity = ServiceIdentity("admin", b"k" * 32)
    on = tenant_resolver("dev", identity)
    assert on._ip_mode is not None and on._ip_mode.load is None
    assert tenant_resolver("v1.0.0", identity)._ip_mode is None


@pytest.mark.parametrize(
    ("path", "tenant"),
    [
        ("/api/admin/settings/screen", True),
        ("/api/admin/profile", True),
        ("/settings", True),
        ("/settings/admin", True),
        ("/profile/save", True),
        ("/api/admin/session", False),
        ("/api/admin/settingsx", False),
        ("/health", False),
        ("/health-view", False),
        ("/people", False),
        ("/sign-in", False),
        ("/", False),
    ],
)
def test_only_settings_and_profile_paths_are_per_tenant(path: str, tenant: bool) -> None:
    assert is_tenant_path(path) is tenant
