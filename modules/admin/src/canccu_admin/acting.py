"""The acting token (contracts/admin.md, The acting token; D2 of the step 6 plan): a command in
Discord acts with its person's rights, never with rights of the bot's own.

Two keys open the mint: the bot's service identity and `CANCCU_BOT_ADMIN_KEY`, which only the
admin and bot containers hold. The shared service key alone proves only "a module of this stack",
so a module signing as the bot still mints nothing. A token is for one person, one event and one
module, lives a minute and is kept only as its SHA-256. Admin answers it only to the module it
names, with the person's rights cut to that module's, so it never carries `admin.rights.write` or
a role-only right, and a token copied out of a log is useless from a browser or another module.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from canccu_kit import (
    ACTING_HEADER,
    KitError,
    NotSignedIn,
    ServiceForbidden,
    TenantResolver,
    is_tenant_id,
)
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .acting_db import ActingStore, ActingToken
from .roles import RIGHTS_WRITE, ROLE_RIGHTS

log = logging.getLogger("canccu.admin")

BOT_ADMIN_HEADER = "x-canccu-bot-admin-key"
LIFETIME = timedelta(seconds=60)
ROLE_ONLY = frozenset({"tenants.admins.write", "tenants.lifecycle.write", "tenants.access.write"})
"""contracts/tenants.md, Users, roles and membership: only the event-admin role holds them."""
_DISCORD_ID = re.compile(r"[0-9]{1,20}")


def scope(module: str) -> frozenset[str]:
    """What a token for `module` may carry: that module's rights in admin's one list of every
    right (roles.py), never admin.rights.write and never a role-only right."""
    every = ROLE_RIGHTS["owner"]
    return frozenset(
        r for r in every if r.startswith(f"{module}.") and r != RIGHTS_WRITE and r not in ROLE_ONLY
    )


class NoAccount(KitError):
    status = 404
    code = "no_account"


class NotAMember(KitError):
    status = 403
    code = "not_a_member"


def _iso(moment: datetime) -> str:
    return moment.isoformat().replace("+00:00", "Z")


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class Acting:
    store: ActingStore
    bot_admin_key: bytes | None
    """None: this stack set no key, so no token is minted (fails closed)."""
    now: Callable[[], datetime]

    def _check_key(self, presented: str | None) -> None:
        if self.bot_admin_key is None or presented is None:
            raise ServiceForbidden("only the bot with the bot-admin key mints acting tokens")
        if not hmac.compare_digest(self.bot_admin_key, presented.encode()):
            raise ServiceForbidden("only the bot with the bot-admin key mints acting tokens")

    async def mint(self, tenant: str, discord_id: str, module: str) -> dict[str, str]:
        """Membership is the seam of B11 (docs/plans/issue-121.md) until #150: someone who signed
        in and was not removed is a member."""
        account = await self.store.account(discord_id=discord_id)
        if account is None:
            raise NoAccount("no account with that Discord id; sign in once first")
        if account.removed:
            raise NotAMember("not a member of this event")
        token = secrets.token_urlsafe(32)
        now = self.now()
        expires = now + LIFETIME
        await self.store.save(
            _digest(token), ActingToken(tenant, account.user.id, module, expires), now
        )
        log.info("acting token for user %s in %s (%s)", account.user.id, tenant, module)
        return {"token": token, "expires_at": _iso(expires)}

    async def session(self, tenant: str, token: str, caller: str) -> dict[str, Any]:
        found = await self.store.get(_digest(token))
        # One answer for every refusal: the caller learns nothing about which check failed.
        if (
            found is None
            or found.tenant_id != tenant
            or found.module != caller
            or self.now() >= found.expires_at
        ):
            raise NotSignedIn("the acting token is unknown, expired or not for this caller")
        account = await self.store.account(user_id=found.user_id)
        if account is None or account.removed:
            raise NotSignedIn("the acting token is unknown, expired or not for this caller")
        held = ROLE_RIGHTS.get(account.role or "", frozenset())
        return {
            "user": {"id": account.user.id, "name": account.user.name},
            "rights": sorted(held & scope(found.module)),
            "expires_at": _iso(found.expires_at),
            "superadmin": False,
        }


def _tenant(request: Request) -> str:
    tenant = request.query_params.get("tenant_id", "")
    if not is_tenant_id(tenant):
        raise KitError("tenant_id: a tenant id", status=400, code="invalid_request")
    return tenant


def acting_routes(acting: Acting, resolver: TenantResolver) -> list[Route]:
    async def mint(request: Request) -> Response:
        # The middleware verified the caller's signature (install_service_identity).
        if request.state.service != "bot":
            raise ServiceForbidden(f"module {request.state.service} may not mint acting tokens")
        acting._check_key(request.headers.get(BOT_ADMIN_HEADER))
        tenant = _tenant(request)
        try:
            body = await request.json()
        except ValueError as exc:
            raise KitError("a JSON body", status=400, code="invalid_request") from exc
        discord_id = body.get("discord_user_id") if isinstance(body, dict) else None
        module = body.get("module") if isinstance(body, dict) else None
        if not isinstance(discord_id, str) or not _DISCORD_ID.fullmatch(discord_id):
            raise KitError("discord_user_id: a Discord user id", status=400, code="invalid_request")
        if not isinstance(module, str) or not scope(module):
            raise KitError("module: a module with rights", status=400, code="invalid_request")
        if await resolver.by_id(tenant) is None:
            raise KitError("no such event", status=404, code="not_found")
        return JSONResponse(await acting.mint(tenant, discord_id, module), status_code=201)

    async def session(request: Request) -> Response:
        token = request.headers.get(ACTING_HEADER)
        if not token:
            raise NotSignedIn("an acting token is required")
        caller = str(request.state.service)
        return JSONResponse(await acting.session(_tenant(request), token, caller))

    return [
        Route("/internal/admin/acting-tokens", mint, methods=["POST"]),
        Route("/internal/admin/acting-session", session, methods=["GET"]),
    ]
