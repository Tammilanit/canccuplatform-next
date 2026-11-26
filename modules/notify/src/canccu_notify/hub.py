"""What the check-in's done page shows beside the confirmation (docs/design/mockups.html, sheet 7;
#441): the venue's Wi-Fi and what is on now, read from the tenants and agenda APIs as the person
reads them, and the front door's live announcements from Moments (#780), so a member sees the
attendee network and its password and a guest only the public ones (contracts/tenants.md, Venue
profile; contracts/agenda.md, Reading).

The request names the event by its hostname and carries the person's cookie, as the browser's own
read would. These rows are extras: a module that does not answer leaves its row out, never the page.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger("canccu.notify")


class HubReader:
    def __init__(
        self,
        tenants_url: str,
        agenda_url: str,
        http: httpx.AsyncClient,
        moments_url: str = "http://moments:8080",
    ) -> None:
        self.tenants = tenants_url.rstrip("/")
        self.agenda = agenda_url.rstrip("/")
        self.moments = moments_url.rstrip("/")
        self.http = http

    async def _get(
        self, url: str, host: str, cookie: str | None, client_ip: str | None = None
    ) -> Any:
        headers = {"host": host} | ({"cookie": cookie} if cookie else {})
        # Agenda judges the info-page mode by the caller's address; without this it would judge
        # notify's own, never the visitor's (agenda trusts the forwarded address from the proxies).
        if client_ip:
            headers["x-forwarded-for"] = client_ip
        try:
            response = await self.http.get(url, headers=headers)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            log.info("check-in row left out: %s: %s", url, exc)
            return None

    async def venue_wifi(self, host: str, cookie: str | None) -> list[dict[str, Any]]:
        body = await self._get(f"{self.tenants}/api/tenants/current/venue-info", host, cookie)
        wifi = body.get("wifi") if isinstance(body, dict) else None
        return [w for w in wifi if isinstance(w, dict)] if isinstance(wifi, list) else []

    async def agenda_now(
        self, host: str, cookie: str | None, client_ip: str | None = None
    ) -> dict[str, Any] | None:
        body = await self._get(f"{self.agenda}/api/agenda/now", host, cookie, client_ip)
        return body if isinstance(body, dict) else None

    async def announcements(
        self, host: str, cookie: str | None, client_ip: str | None = None
    ) -> list[dict[str, Any]] | None:
        """The live announcements on the screens (contracts/moments.md, Sending), newest first.
        None: Moments did not answer, or the info-page mode keeps this visitor out."""
        url = f"{self.moments}/api/moments/announcements/live"
        body = await self._get(url, host, cookie, client_ip)
        items = body.get("announcements") if isinstance(body, dict) else None
        return [a for a in items if isinstance(a, dict)] if isinstance(items, list) else None

    async def agenda_kinds(self, host: str, cookie: str | None) -> list[dict[str, Any]] | None:
        """The event's item kinds as the person reads them (contracts/agenda.md, Kinds), for the
        custom editor's value list; None when the agenda does not answer."""
        body = await self._get(f"{self.agenda}/api/agenda/kinds", host, cookie)
        kinds = body.get("kinds") if isinstance(body, dict) else None
        if not isinstance(kinds, list):
            return None
        return [k for k in kinds if isinstance(k, dict) and isinstance(k.get("key"), str)]
