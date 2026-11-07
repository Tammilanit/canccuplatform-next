"""Sign-in logic: the first-run code, the Discord round trip, sessions, roles and rights.

Built to fit the central sign-in host of step 2b (#52, 0013 item 10) rather than be redone
there: OAuth `state` bound to the browser plus PKCE, absolute URLs only from CANCCU_PUBLIC_URL
(never from `Host`), opaque host-only session cookies, idle and absolute expiry, a new session
on every sign-in.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from canccu_kit import Bus, Event, KitError, NotSignedIn
from canccu_kit.rights import Session

from .auth_db import AuthStore, Flow, User
from .discord import Discord, DiscordFailed

log = logging.getLogger("canccu.admin")

IDLE = timedelta(hours=4)
ABSOLUTE = timedelta(hours=24)
FLOW_LIFETIME = timedelta(minutes=10)
# Writing last_seen_at on every rights check would turn each read into a write.
TOUCH_AFTER = timedelta(minutes=1)
# No 0/O, 1/I/L or 8: the code is read from a log and typed by hand. 12 of 30 symbols ≈ 59 bits.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ2345679"
CODE_LENGTH = 12

ADMIN_RIGHTS = frozenset(
    {
        "admin.settings.read",
        "admin.settings.write",
        "admin.profile.read",
        "admin.profile.write",
    }
)
# Other modules' rights join these sets as their modules land (#56 makes them per tenant).
ROLE_RIGHTS: dict[str, frozenset[str]] = {
    "owner": ADMIN_RIGHTS | {"admin.rights.write"},
    "admin": ADMIN_RIGHTS,
}


class SignInFailed(KitError):
    status = 400
    code = "sign_in_failed"


class FirstRunClosed(KitError):
    status = 409
    code = "first_run_closed"


class BadRole(KitError):
    status = 400
    code = "bad_role"


class UnknownUser(KitError):
    status = 404
    code = "not_found"


class SignInUnavailable(KitError):
    status = 503
    code = "sign_in_unavailable"


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def normalize_code(raw: str) -> str:
    return "".join(c for c in raw.upper() if c.isalnum())


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")


class Auth:
    def __init__(
        self,
        store: AuthStore,
        bus: Bus,
        public_url: str | None,
        discord: Discord | None,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.store = store
        self.bus = bus
        self.public_url = public_url.rstrip("/") if public_url else None
        self.discord = discord
        self._now = now

    @property
    def public_origin(self) -> str | None:
        if not self.public_url:
            return None
        parts = urlsplit(self.public_url)
        return f"{parts.scheme}://{parts.netloc}"

    @property
    def secure_cookies(self) -> bool:
        return bool(self.public_url and self.public_url.startswith("https://"))

    # first-run code
    async def issue_first_run_code(self) -> str | None:
        """A new code while there is no owner (each start replaces the last); logs it."""
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if not await self.store.set_first_run_code(digest(code), self._now()):
            return None
        shown = "-".join(code[i : i + 4] for i in range(0, CODE_LENGTH, 4))
        where = f"{self.public_url}/admin/first-run" if self.public_url else "/admin/first-run"
        # Printing the code is the point: whoever can read admin's log may become the owner.
        log.warning(
            "first-run code: %s - open %s and sign in with Discord to become the owner;"
            " a restart replaces the code",
            shown,
            where,
        )
        return shown

    async def check_first_run_code(self, raw: str) -> str:
        """The code's hash if it may claim ownership now."""
        if await self.store.has_owner():
            raise FirstRunClosed("this platform already has an owner; sign in instead")
        code_hash = digest(normalize_code(raw))
        if not await self.store.first_run_matches(code_hash):
            log.warning("wrong first-run code entered")
            raise SignInFailed("that is not the current first-run code (see admin's log)")
        return code_hash

    # Discord round trip
    async def start(self, claim_hash: str | None = None) -> tuple[str, str]:
        """(authorize URL, flow nonce for the browser's cookie)."""
        if self.discord is None:
            raise SignInUnavailable("Discord sign-in is not configured")
        now = self._now()
        state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        flow = Flow(digest(nonce), verifier, claim_hash, now + FLOW_LIFETIME)
        await self.store.prune(now, now - IDLE)
        await self.store.save_flow(digest(state), flow, now)
        url = self.discord.authorize_url(state, challenge.rstrip(b"=").decode())
        return url, nonce

    async def finish(
        self, state: str, nonce: str | None, code: str, old_session: str | None
    ) -> tuple[str, User]:
        """Check the flow, ask Discord who signed in, start a session: (session id, user)."""
        if self.discord is None:
            raise SignInUnavailable("Discord sign-in is not configured")
        now = self._now()
        flow = await self.store.take_flow(digest(state), now)
        # The nonce cookie ties the state to the browser that started the flow (login CSRF).
        if flow is None or not nonce or not hmac.compare_digest(flow.nonce_hash, digest(nonce)):
            raise SignInFailed("this sign-in link is unknown or expired; start again")
        try:
            who = await self.discord.user_for_code(code, flow.verifier)
        except DiscordFailed as exc:
            log.warning("discord sign-in failed: %s", exc)
            raise KitError(
                "Discord did not confirm the sign-in", status=502, code="discord_failed"
            ) from exc
        if flow.claim_hash is None:
            user = await self.store.upsert_user(who.id, who.name, now)
        else:
            claimed = await self.store.claim_owner(who.id, who.name, flow.claim_hash, now)
            if claimed is None:
                raise FirstRunClosed("the first-run code was used or replaced meanwhile")
            user = claimed
            log.warning("first-run code used: user %s is the owner", user.id)
        if old_session:
            await self.store.delete_session(digest(old_session))
        session_id = secrets.token_urlsafe(32)
        await self.store.create_session(digest(session_id), user.id, now, now + ABSOLUTE)
        log.info("signed in: user %s", user.id)
        return session_id, user

    # sessions
    async def session(self, session_id: str | None) -> Session:
        if not session_id:
            raise NotSignedIn("sign in first")
        id_hash = digest(session_id)
        row = await self.store.get_session(id_hash)
        now = self._now()
        if row is None:
            raise NotSignedIn("sign in first")
        if now >= row.expires_at or now >= row.last_seen_at + IDLE:
            await self.store.delete_session(id_hash)
            raise NotSignedIn("the session expired; sign in again")
        last_seen = row.last_seen_at
        if now - last_seen >= TOUCH_AFTER:
            await self.store.touch_session(id_hash, now)
            last_seen = now
        rights = ROLE_RIGHTS.get(row.role or "", frozenset())
        expires = min(row.expires_at, last_seen + IDLE)
        return Session(row.user.id, row.user.name, rights, expires)

    async def session_body(self, session_id: str | None) -> dict[str, object]:
        """GET /api/admin/session (contracts/admin.md)."""
        s = await self.session(session_id)
        return {
            "user": {"id": s.user_id, "name": s.user_name},
            "rights": sorted(s.rights),
            "expires_at": _iso(s.expires_at),
        }

    async def sign_out(self, session_id: str | None) -> None:
        await self.session(session_id)  # refuses a missing, unknown or expired session
        await self.store.delete_session(digest(session_id or ""))

    # roles
    async def users(self) -> list[tuple[User, str | None]]:
        return await self.store.list_users()

    async def set_role(self, user_id: str, role: str | None, actor: str) -> Event:
        """Grant `admin` or remove it; the owner's role is fixed. Emits admin.rights.changed."""
        if role not in ("admin", None):
            raise BadRole("role must be admin or none")
        found = await self.store.get_role(user_id)
        if found is None:
            raise UnknownUser("no such user")
        if found[1] == "owner":
            raise BadRole("the owner's role cannot be changed")
        await self.store.set_role(user_id, role, actor, self._now())
        return await self.bus.publish(
            "admin.rights.changed",
            {
                "user_id": user_id,
                "rights": sorted(ROLE_RIGHTS.get(role or "", frozenset())),
                "actor_user_id": actor,
            },
            version=1,
            platform=True,  # admin is single-event until #56, as in service.py
        )
