"""Rights check through GET /api/admin/session, cached for at most 30 s (contracts/admin.md)."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from .admin import AdminClient
from .bus import Event
from .errors import MissingRight, NotSignedIn

SESSION_COOKIE = "canccu_session"
CACHE_SECONDS = 30.0


@dataclass(frozen=True)
class Session:
    user_id: str
    user_name: str
    rights: frozenset[str]
    expires_at: datetime

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


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


class RightsChecker:
    def __init__(
        self,
        admin: AdminClient,
        *,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._admin = admin
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
        if response.status_code == 401:
            raise NotSignedIn("sign in first")
        self._admin.raise_for_error(response)
        body = response.json()
        session = Session(
            user_id=str(body["user"]["id"]),
            user_name=str(body["user"]["name"]),
            rights=frozenset(str(r) for r in body["rights"]),
            expires_at=_parse_time(str(body["expires_at"])),
        )
        self._remember(session_id, session)
        return session

    async def check(self, cookie_header: str | None, right: str) -> Session:
        """The session if it holds `right`; raises NotSignedIn, MissingRight or AdminUnavailable."""
        session = await self.session(cookie_header)
        if not session.has(right):
            raise MissingRight(f"needs right {right}")
        return session

    async def handle_event(self, event: Event) -> None:
        """Feed events from `events:admin`; drops the user's cached sessions on a rights change."""
        if event.type != "admin.rights.changed":
            return
        user_id = event.data.get("user_id")
        if isinstance(user_id, str):
            for session_id in list(self._by_user.get(user_id, ())):
                self._forget(session_id)
