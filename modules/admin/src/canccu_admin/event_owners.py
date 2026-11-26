"""The owners of what admin's Event page and home show (#782 part B, plan D7): the tenants API as
the person, and Screen's zone list as admin's service.

The event's own values are the tenants module's, so admin reads and saves them through the tenants
API as the person: their cookie decides the right and their address, forwarded as Caddy gave it,
decides `admin_access`, never admin's own address (contracts/tenants.md, Admin access).
"""

from __future__ import annotations

from typing import Any

import httpx
from canccu_kit import KitError, ServiceIdentity
from starlette.requests import Request

CURRENT = "/api/tenants/current"
# The home never waits long for Screen: a page that does not answer leaves a notice (D6).
SCREEN_WAIT_S = 2.0


def _refusal(response: httpx.Response, answer: Any) -> KitError:
    error = answer.get("error", {}) if isinstance(answer, dict) else {}
    return KitError(
        str(error.get("message", "tenants refused")),
        status=response.status_code if response.status_code >= 400 else 503,
        code=str(error.get("code", "tenants_unavailable")),
    )


class TenantsApi:
    """The tenants API on the request's own hostname, as the person."""

    def __init__(self, url: str, http: httpx.AsyncClient) -> None:
        self.url = url.rstrip("/")
        self.http = http

    def _headers(self, request: Request) -> dict[str, str]:
        headers = {"host": request.headers.get("host", "")}
        for name in ("cookie", "x-forwarded-for"):
            if name in request.headers:
                headers[name] = request.headers[name]
        return headers

    async def call(
        self,
        request: Request,
        method: str,
        body: dict[str, Any] | None = None,
        *,
        path: str = CURRENT,
        content: bytes | None = None,
        content_type: str | None = None,
    ) -> Any:
        """The owner's answer; a refusal or no answer raises KitError with its status and code."""
        headers = self._headers(request)
        if content_type is not None:
            headers["content-type"] = content_type
        try:
            response = await self.http.request(
                method,
                f"{self.url}{path}",
                headers=headers,
                json=body if content is None else None,
                content=content,
            )
            answer = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise KitError(
                "tenants did not answer", status=503, code="tenants_unavailable"
            ) from exc
        if response.is_success and isinstance(answer, dict):
            return answer
        raise _refusal(response, answer)

    async def read(self, request: Request, path: str = CURRENT) -> dict[str, Any] | None:
        """A read for a section of a page: None when tenants refuses it or does not answer, so
        that section says so and the rest of the page renders."""
        return (await self.read_status(request, path))[0]

    async def read_status(
        self, request: Request, path: str = CURRENT
    ) -> tuple[dict[str, Any] | None, int]:
        """`read` with why it came back empty: 404 (nothing there), 403 (not the person's to
        see) or 503 (no answer); 200 with the answer otherwise."""
        try:
            answer: dict[str, Any] = await self.call(request, "GET", path=path)
        except KitError as exc:
            return None, exc.status
        return answer, 200


class ScreenApi:
    """Screen's internal zone list (contracts/screen.md, Internal), as admin's service."""

    def __init__(self, url: str, http: httpx.AsyncClient, identity: ServiceIdentity) -> None:
        self.url = url.rstrip("/")
        self.http = http
        self.identity = identity

    async def zones(self, tenant_id: str) -> list[tuple[str, str]] | None:
        """(key, name) of each of the event's zones; None when Screen does not answer in time."""
        try:
            response = await self.http.get(
                f"{self.url}/internal/screen/zones",
                params={"tenant_id": tenant_id},
                headers=self.identity.headers("screen"),
                timeout=SCREEN_WAIT_S,
            )
            zones = response.json()["zones"] if response.is_success else None
            return None if zones is None else [(str(z["key"]), str(z["name"])) for z in zones]
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return None
