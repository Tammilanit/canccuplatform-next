"""HTTP client for the admin API, shared by the settings client and the rights check."""

from __future__ import annotations

from typing import Any

import httpx

from .errors import AdminError, AdminUnavailable, parse_error_body


class AdminClient:
    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(base_url=base_url, timeout=5.0)

    async def request(
        self,
        method: str,
        path: str,
        *,
        session_id: str | None = None,
        json: Any = None,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        sent = dict(headers or {})
        if session_id:
            sent["cookie"] = f"canccu_session={session_id}"
        try:
            return await self._client.request(method, path, json=json, params=params, headers=sent)
        except httpx.TransportError as exc:
            raise AdminUnavailable(f"admin unreachable: {type(exc).__name__}") from exc

    @staticmethod
    def raise_for_error(response: httpx.Response) -> None:
        if response.is_success:
            return
        if response.status_code >= 500:
            raise AdminUnavailable(f"admin answered {response.status_code}")
        try:
            parsed = parse_error_body(response.json())
        except ValueError:
            parsed = None
        code, message = parsed or (f"http_{response.status_code}", response.reason_phrase)
        raise AdminError(message, status=response.status_code, code=code)

    async def close(self) -> None:
        await self._client.aclose()
