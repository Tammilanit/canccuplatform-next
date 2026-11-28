"""Rights check through GET /api/admin/session, cached for at most 30 s (contracts/admin.md).

A command in Discord acts for its person with an acting token (contracts/admin.md, The acting
token): `from_headers` takes it only beside the bot's service identity, which a browser cannot
make, so a token copied out of a log opens nothing on its own."""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .access import parse_time
from .admin import AdminClient
from .bus import Event
from .errors import MissingRight, NotSignedIn
from .service import SERVICE_HEADER, ServiceIdentity
from .tenant import current_tenant

SESSION_COOKIE = "canccu_session"
CACHE_SECONDS = 30.0
ACTING_HEADER = "x-canccu-acting"
ACTING_CALLER = "bot"
"""The only module that may bring an acting token: the bot gains no rights of its own (D2)."""


@dataclass(frozen=True)
class Session:
    user_id: str
    user_name: str
    rights: frozenset[str]
    expires_at: datetime
    superadmin: bool = False
    """Admin's word that this is a superadmin's platform session with two-factor
    (contracts/admin.md, Session and rights); a missing field is false."""

    def has(self, right: str) -> bool:
        return right in self.rights


def session_id_from_cookie(cookie_header: str | None) -> str | None:
    """The canccu_session value from a Cookie header, or None."""
    if not cookie_header:
        return None
    for part in cookie_header.split(";"):
        name, sep, value = part.strip().partition("=")
        if sep and name == SESSION_COOKIE and value:
            return value.strip('"')
    return None


class RightsChecker:
    def __init__(
        self,
        admin: AdminClient,
        *,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        service: ServiceIdentity | None = None,
    ) -> None:
        """`service`: this module's own identity, which checks the bot's header and signs the
        call to admin; without it no acting token is taken."""
        self._admin = admin
        self._service = service
        self._clock = clock
        self._wall = wall_clock
        self._cache: dict[str, tuple[float, Session]] = {}
        self._by_user: dict[str, set[str]] = {}

    def _cached(self, session_id: str) -> Session | None:
        entry = self._cache.get(session_id)
        if entry is None:
            return None
        if self._clock() >= entry[0]:
            self._forget(session_id)
            return None
        return entry[1]

    def _remember(self, session_id: str, session: Session) -> None:
        left = (session.expires_at - self._wall()).total_seconds()
        ttl = min(CACHE_SECONDS, left)
        if ttl <= 0:
            return
        self._cache[session_id] = (self._clock() + ttl, session)
        self._by_user.setdefault(session.user_id, set()).add(session_id)

    def _forget(self, session_id: str) -> None:
        entry = self._cache.pop(session_id, None)
        if entry is not None:
            ids = self._by_user.get(entry[1].user_id)
            if ids is not None:
                ids.discard(session_id)
                if not ids:
                    del self._by_user[entry[1].user_id]

    async def session(self, cookie_header: str | None) -> Session:
        """The signed-in session; raises NotSignedIn or AdminUnavailable."""
        session_id = session_id_from_cookie(cookie_header)
        if session_id is None:
            raise NotSignedIn("sign in first")
        cached = self._cached(session_id)
        if cached is not None:
            return cached
        response = await self._admin.request("GET", "/api/admin/session", session_id=session_id)
        session = self._parse(response)
        self._remember(session_id, session)
        return session

    def _parse(self, response: Any) -> Session:
        if response.status_code == 401:
            raise NotSignedIn("sign in first")
        self._admin.raise_for_error(response)
        body = response.json()
        return Session(
            user_id=str(body["user"]["id"]),
            user_name=str(body["user"]["name"]),
            rights=frozenset(str(r) for r in body["rights"]),
            expires_at=parse_time(str(body["expires_at"])),
            superadmin=body.get("superadmin") is True,
        )

    async def acting(self, service_header: str | None, token: str) -> Session:
        """The person an acting token stands for, in the tenant in scope; raises
        ServiceUnauthenticated or ServiceForbidden when the bot did not send it, NotSignedIn for a
        token admin refuses. Never cached: a token lives a minute and names one module."""
        tenant = current_tenant()
        if self._service is None or tenant is None:
            raise NotSignedIn("sign in first")
        self._service.require(service_header, [ACTING_CALLER])
        response = await self._admin.request(
            "GET",
            "/internal/admin/acting-session",
            params={"tenant_id": tenant},
            headers={**self._service.headers("admin"), ACTING_HEADER: token},
        )
        return self._parse(response)

    async def from_headers(self, headers: Mapping[str, str]) -> Session:
        """The session a request stands for: its acting token when it carries one, else its
        cookie's."""
        token = headers.get(ACTING_HEADER)
        if token is not None:
            return await self.acting(headers.get(SERVICE_HEADER), token)
        return await self.session(headers.get("cookie"))

    async def check_headers(self, headers: Mapping[str, str], right: str) -> Session:
        session = await self.from_headers(headers)
        if not session.has(right):
            raise MissingRight(f"needs right {right}")
        return session

    async def check(self, cookie_header: str | None, right: str) -> Session:
        """The session if it holds `right`; raises NotSignedIn, MissingRight or AdminUnavailable."""
        session = await self.session(cookie_header)
        if not session.has(right):
            raise MissingRight(f"needs right {right}")
        return session

    async def require_superadmin(self, cookie_header: str | None) -> Session:
        """The session if admin says it is the superadmin's; raises NotSignedIn, MissingRight or
        AdminUnavailable. The caller still answers its superadmin paths only on the superadmin
        hostname (contracts/admin.md)."""
        session = await self.session(cookie_header)
        if not session.superadmin:
            raise MissingRight("superadmins only")
        return session

    def forget_session(self, session_id: str) -> None:
        """Drop one session's cached answer, e.g. when it ends in this process (admin's sign-out),
        so a copied cookie stops working at once instead of after up to 30 s."""
        self._forget(session_id)

    async def handle_event(self, event: Event) -> None:
        """Feed events from `events:admin`; drops the user's cached sessions on a rights change."""
        if event.type != "admin.rights.changed":
            return
        user_id = event.data.get("user_id")
        if isinstance(user_id, str):
            for session_id in list(self._by_user.get(user_id, ())):
                self._forget(session_id)
