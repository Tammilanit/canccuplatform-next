"""Check-in by the rotating QR (contracts/notify.md): codes, check-ins and the caller's list.

Check-in is an extra, never a gate (docs/plans/issue-188.md, D11): no other Notify path reads
check-ins, and tests/test_never_mandatory.py keeps it so.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

from canccu_kit import (
    KitError,
    MissingRight,
    check_admin_access,
    is_tenant_id,
    tailscale_cidrs,
    tenant_scope,
)
from canccu_kit.access import TenantContext
from canccu_kit.rights import Session
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .access import client_ip, is_member, tenant_ctx, tenant_of
from .deps import Deps, deps
from .engine import iso_time
from .registry import bad, body_of

DISPLAY = "notify.checkin.display"
PURPOSE_RE = re.compile(r"arrival|[a-z]+:[A-Za-z0-9_-]{1,64}")
CODE_RE = re.compile(r"[A-Za-z0-9_-]{22}")
ROTATION_DEFAULT = 30
VALID_PERIODS = 2  # the current period and the one before
EXPIRED_PERIODS = 10  # before those: `code_expired` rather than `code_invalid`


class CodeInvalid(KitError):
    status = 400
    code = "code_invalid"


class CodeExpired(KitError):
    status = 400
    code = "code_expired"


class EventArchived(KitError):
    status = 409
    code = "event_archived"


def writable(ctx: TenantContext) -> None:
    """contracts/tenants.md, Lifecycle: an archived event is read-only. A check-in or a new key
    there would add presence data after its retention clock has started."""
    if ctx["status"] == "archived":
        raise EventArchived("the event has ended and takes no check-ins")


class NotAMember(KitError):
    status = 403
    code = "not_a_member"


def valid_purpose(value: object) -> str | None:
    return value if isinstance(value, str) and PURPOSE_RE.fullmatch(value) else None


def valid_code(value: object) -> str | None:
    return value if isinstance(value, str) and CODE_RE.fullmatch(value) else None


def code_for(key: bytes, tenant_id: str, purpose: str, period: int) -> str:
    # Neither a tenant id nor a purpose can hold a newline, so the message is unambiguous.
    message = f"{tenant_id}\n{purpose}\n{period}".encode()
    mac = hmac.new(key, message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac[:16]).rstrip(b"=").decode("ascii")


def verify(key: bytes, tenant_id: str, purpose: str, period: int, code: str) -> None:
    """Raises CodeInvalid or CodeExpired. Every candidate is compared, so the time taken does not
    tell which period matched."""
    matches = [
        hmac.compare_digest(code_for(key, tenant_id, purpose, period - back), code)
        for back in range(VALID_PERIODS + EXPIRED_PERIODS)
    ]
    if any(matches[:VALID_PERIODS]):
        return
    if any(matches[VALID_PERIODS:]):
        raise CodeExpired("this code has expired; scan the screen again")
    raise CodeInvalid("this is not a valid check-in code")


async def period_now(d: Deps) -> tuple[int, int]:
    """(period length, current period) for the tenant in scope.

    No fallback to the default while admin is down (503): a container that guessed the length
    would refuse every code another container showed.
    """
    await d.settings.ensure()
    value = d.settings.get("check_in_rotation_seconds", ROTATION_DEFAULT)
    length = value if type(value) is int and 15 <= value <= 120 else ROTATION_DEFAULT
    return length, int(d.now().timestamp()) // length


def _aad(tenant_id: str) -> str:
    return f"notify:checkin:{tenant_id}"


async def event_key(d: Deps, tenant_id: str, *, create: bool) -> bytes | None:
    """The event's key, made on its first code request (D5): random per event, so a leaked key
    tells nothing about another event's codes."""
    async with d.db.tenant(tenant_id) as conn:
        sealed = await conn.fetchval("SELECT sealed FROM notify_check_in_keys")
        if sealed is None and create:
            # Two first requests at once: the first insert wins and both read it back.
            await conn.execute(
                "INSERT INTO notify_check_in_keys (sealed, created_at) VALUES ($1, $2)"
                " ON CONFLICT (tenant_id) DO NOTHING",
                d.secrets.seal(secrets.token_bytes(32), _aad(tenant_id)),
                d.now(),
            )
            sealed = await conn.fetchval("SELECT sealed FROM notify_check_in_keys")
    return None if sealed is None else d.secrets.open(sealed, _aad(tenant_id))


def _at(seconds: int) -> str:
    return iso_time(datetime.fromtimestamp(seconds, UTC))


async def code_now(d: Deps, ctx: TenantContext, purpose: str) -> dict[str, Any]:
    writable(ctx)
    tenant_id = ctx["tenant_id"]
    length, period = await period_now(d)
    key = await event_key(d, tenant_id, create=True)
    assert key is not None
    code = code_for(key, tenant_id, purpose, period)
    path = "/notify/check-in?" + urlencode({"p": purpose, "c": code})
    host = ctx["primary_hostname"]
    return {
        "purpose": purpose,
        "code": code,
        # Without an active hostname no absolute URL can be built (contracts/tenants.md); the
        # path still works on whichever of the event's hostnames shows it.
        "url": f"https://{host}{path}" if host else path,
        "valid_until": _at((period + VALID_PERIODS) * length),
        "rotates_at": _at((period + 1) * length),
    }


def view(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "purpose": row["purpose"],
        "checked_in_at": iso_time(row["checked_in_at"]),
    }


async def record(
    d: Deps, ctx: TenantContext, session: Session, purpose: str, code: str
) -> tuple[dict[str, Any], bool]:
    """(the check-in, whether this call made it). Raises EventArchived, NotAMember, CodeInvalid,
    CodeExpired."""
    writable(ctx)
    if not is_member(session.user_id):
        raise NotAMember("only members of the event can check in")
    tenant_id = ctx["tenant_id"]
    key = await event_key(d, tenant_id, create=False)
    if key is None:
        raise CodeInvalid("this is not a valid check-in code")
    _, period = await period_now(d)
    verify(key, tenant_id, purpose, period, code)
    async with d.db.tenant(tenant_id) as conn:
        row = await conn.fetchrow(
            "INSERT INTO notify_check_ins (id, user_id, purpose, checked_in_at)"
            " VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, user_id, purpose) DO NOTHING"
            " RETURNING id, purpose, checked_in_at",
            f"ci_{secrets.token_urlsafe(12)}",
            session.user_id,
            purpose,
            d.now(),
        )
        created = row is not None
        if row is None:
            row = await conn.fetchrow(
                "SELECT id, purpose, checked_in_at FROM notify_check_ins"
                " WHERE user_id = $1 AND purpose = $2",
                session.user_id,
                purpose,
            )
    found = view(row)
    if created:
        data = {
            "user_id": session.user_id,
            "purpose": purpose,
            "check_in_id": found["id"],
            "checked_in_at": found["checked_in_at"],
        }
        await d.bus.publish("notify.checkin.recorded", data, version=1, tenant=tenant_id)
    return found, created


def _purpose_param(request: Request) -> str:
    purpose = valid_purpose(request.query_params.get("purpose"))
    if purpose is None:
        raise bad("purpose: `arrival` or `<module>:<ref>`")
    return purpose


async def get_code(request: Request) -> Response:
    ctx = tenant_of(request)
    d = deps(request)
    session = await d.rights.session(request.headers.get("cookie"))
    if not session.has(DISPLAY):
        raise MissingRight(f"needs right {DISPLAY}")
    # A code fetched from home would let people check in remotely: the event's admin-access
    # rule (contracts/tenants.md, Access) keeps the right to the venue or Tailscale.
    check_admin_access(ctx, client_ip(request), tailscale_cidrs())
    return JSONResponse(await code_now(d, ctx, _purpose_param(request)))


async def get_code_internal(request: Request) -> Response:
    """For the screen module's server: a door screen is a device with no session."""
    d = deps(request)
    purpose = _purpose_param(request)
    tenant_id = request.query_params.get("tenant_id", "")
    ctx = await d.tenants.by_id(tenant_id) if is_tenant_id(tenant_id) else None
    if ctx is None:
        raise KitError("no such event", status=404, code="not_found")
    with tenant_scope(tenant_id):
        return JSONResponse(await code_now(d, ctx, purpose))


async def post_check_in(request: Request) -> Response:
    ctx = await tenant_ctx(request)
    d = deps(request)
    session = await d.rights.session(request.headers.get("cookie"))
    body = await body_of(request)
    purpose, code = valid_purpose(body.get("purpose")), valid_code(body.get("code"))
    if purpose is None or code is None:
        raise bad("purpose and code: both from the scanned QR")
    found, created = await record(d, ctx, session, purpose, code)
    return JSONResponse(found, status_code=201 if created else 200)


async def mine(request: Request) -> Response:
    tenant_of(request)
    d = deps(request)
    session = await d.rights.session(request.headers.get("cookie"))
    async with d.db.tenant() as conn:
        rows = await conn.fetch(
            "SELECT id, purpose, checked_in_at FROM notify_check_ins WHERE user_id = $1"
            " ORDER BY checked_in_at, id",
            session.user_id,
        )
    return JSONResponse({"check_ins": [view(r) for r in rows]})


ROUTES = [
    Route("/api/notify/check-in/code", get_code, methods=["GET"]),
    Route("/api/notify/check-ins", post_check_in, methods=["POST"]),
    Route("/api/notify/check-ins/mine", mine, methods=["GET"]),
]
INTERNAL_ROUTES = [Route("/internal/notify/check-in/code", get_code_internal, methods=["GET"])]
