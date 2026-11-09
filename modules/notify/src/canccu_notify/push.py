"""Sending one push, and the key the hub subscribes with (contracts/notify.md, Web Push)."""

from __future__ import annotations

import logging
from datetime import datetime

import httpx
from canccu_kit import check_info_access
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import webpush
from .access import client_ip, session_of, tenant_ctx
from .deps import deps
from .webpush import Vapid

log = logging.getLogger("canccu_notify.push")
GONE = (404, 410)
"""The push service's answer that the subscription no longer exists (RFC 8030 section 7.3)."""


class Pusher:
    def __init__(self, vapid: Vapid, http: httpx.AsyncClient | None = None) -> None:
        self.vapid = vapid
        # No redirects: the endpoint came from a browser, and a redirect could point anywhere.
        self.http = http or httpx.AsyncClient(timeout=10.0, follow_redirects=False)

    async def send(
        self,
        endpoint: str,
        keys: dict[str, str],
        body: bytes,
        *,
        urgent: bool,
        expires_at: datetime,
        now: datetime,
    ) -> int:
        """The push service's status, or 0 when it could not be reached."""
        headers = {
            "authorization": self.vapid.authorization(endpoint, now),
            "content-encoding": "aes128gcm",
            "content-type": "application/octet-stream",
            # The push service keeps an undelivered message until it expires, not longer.
            "ttl": str(max(0, int((expires_at - now).total_seconds()))),
            "urgency": "high" if urgent else "normal",
        }
        sealed = webpush.encrypt(body, keys["p256dh"], keys["auth"])
        try:
            response = await self.http.post(endpoint, content=sealed, headers=headers)
        except httpx.HTTPError as exc:
            log.warning("push service unreachable: %s", type(exc).__name__)
            return 0
        return response.status_code

    async def close(self) -> None:
        await self.http.aclose()


async def push_key(request: Request) -> Response:
    """For anyone the event's info-page mode lets in, as the topics list."""
    ctx = await tenant_ctx(request)
    if await session_of(request) is None:
        check_info_access(ctx, client_ip=client_ip(request), viewer="guest")
    return JSONResponse({"vapid_public_key": deps(request).push.vapid.public_key})


ROUTES = [Route("/api/notify/push-key", push_key, methods=["GET"])]
