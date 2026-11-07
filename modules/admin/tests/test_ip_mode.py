"""IP mode (the CI demo stack): admin serves the demo tenant on an IP literal only while the
tenants module does (0013 item 2)."""

from __future__ import annotations

import httpx
import pytest
from canccu_kit import TenantResolver, TenantsUnavailable, UnknownHost

from canccu_admin.tenancy import ip_mode, is_tenant_path

DEMO = {"id": "demo", "name": "Demo Event", "status": "live", "time_zone": "Europe/Helsinki"}


def resolver(answer: httpx.Response, seen: list[httpx.Request] | None = None) -> TenantResolver:
    def tenants(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return answer

    http = httpx.AsyncClient(transport=httpx.MockTransport(tenants))
    return TenantResolver(
        "http://tenants:8080", ip_mode=ip_mode("dev", "http://tenants:8080", http), http=http
    )


async def test_serves_the_demo_tenant_the_tenants_module_serves() -> None:
    seen: list[httpx.Request] = []
    resolution = await resolver(httpx.Response(200, json=DEMO), seen).resolve("192.0.2.10")
    assert resolution.context is not None
    assert resolution.context["tenant_id"] == "demo"
    assert resolution.context["time_zone"] == "Europe/Helsinki"
    # Asked as a guest, on an IP literal, so the tenants module applies its own IP-mode rule.
    assert [(r.url.path, r.headers["host"], r.headers.get("cookie")) for r in seen] == [
        ("/api/tenants/current", "127.0.0.1", None)
    ]


@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(404, json={"error": {"code": "not_found", "message": "Not found."}}),
        httpx.Response(200, json={**DEMO, "id": "other"}),
        httpx.Response(200, json=["demo"]),
    ],
)
async def test_serves_nothing_when_the_tenants_module_does_not(answer: httpx.Response) -> None:
    with pytest.raises(UnknownHost):
        await resolver(answer).resolve("192.0.2.10")


async def test_a_failing_tenants_module_is_503_not_a_tenant() -> None:
    with pytest.raises(TenantsUnavailable):
        await resolver(httpx.Response(502)).resolve("192.0.2.10")


def test_refuses_to_start_outside_dev() -> None:
    http = httpx.AsyncClient()
    with pytest.raises(Exception, match="dev"):
        TenantResolver("http://tenants", ip_mode=ip_mode("v1.0.0", "http://tenants", http))


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
