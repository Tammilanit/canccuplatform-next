"""Calls to an outside provider, with a per-event bearer secret for one that wants it (What
`/finals` needs, item 5): the standalone Finals app takes a bearer secret, the platform's own
modules take the acting token instead (acting.py). Which provider an event uses is the Finals
track's setting; the secret is held like the bot's other secrets: sealed with the kit's SecretBox
and bound to the event and the provider, write-only, never in a reply, a log or an event.

`PUT /api/bot/providers/{provider}/secret` sets it and `DELETE` clears it, the event-admin role
itself (contracts/bot.md, Provider secrets); both are audited, never with the value."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx
from canccu_kit import KitError, SecretUndecryptable, parse_error_body
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from .access import deps, event_admin
from .deps import Deps
from .framework import Refused, Unreachable
from .guild import audit

log = logging.getLogger("canccu_bot.providers")

_PROVIDER = re.compile(r"[a-z][a-z0-9_]{0,31}")
MAX_SECRET = 512


def secret_aad(tenant: str, provider: str) -> str:
    return f"bot:provider:{tenant}:{provider}"


def _provider(request: Request) -> str:
    provider = str(request.path_params["provider"])
    if not _PROVIDER.fullmatch(provider):
        raise KitError("no such provider", status=404, code="not_found")
    return provider


async def put_secret(request: Request) -> Response:
    ctx, session = await event_admin(request)
    provider = _provider(request)
    try:
        body = await request.json()
    except ValueError as exc:
        raise KitError("a JSON body", status=400, code="invalid_request") from exc
    secret = body.get("secret") if isinstance(body, dict) else None
    if not isinstance(secret, str) or not secret.strip() or len(secret) > MAX_SECRET:
        raise KitError(f"secret: 1 to {MAX_SECRET} characters", status=400, code="invalid_request")
    d = deps(request)
    tenant = ctx["tenant_id"]
    sealed = d.secrets.seal(secret, secret_aad(tenant, provider))
    async with d.db.tenant(tenant) as conn:
        await conn.execute(
            "INSERT INTO bot_provider_secrets (provider, secret, updated_at) VALUES ($1, $2, $3)"
            " ON CONFLICT (tenant_id, provider) DO UPDATE SET secret = EXCLUDED.secret,"
            " updated_at = EXCLUDED.updated_at",
            provider,
            sealed,
            d.now(),
        )
    await audit(d, tenant, session.user_id, "bot.provider_secret.set", {}, "provider", provider)
    return Response(status_code=204)


async def delete_secret(request: Request) -> Response:
    ctx, session = await event_admin(request, writable=False)  # deletes data: also when archived
    provider = _provider(request)
    d = deps(request)
    tenant = ctx["tenant_id"]
    async with d.db.tenant(tenant) as conn:
        gone = await conn.fetchval(
            "DELETE FROM bot_provider_secrets WHERE provider = $1 RETURNING provider", provider
        )
    if gone is not None:
        await audit(
            d, tenant, session.user_id, "bot.provider_secret.cleared", {}, "provider", provider
        )
    return Response(status_code=204)


ROUTES = [
    Route("/api/bot/providers/{provider}/secret", put_secret, methods=["PUT"]),
    Route("/api/bot/providers/{provider}/secret", delete_secret, methods=["DELETE"]),
]


async def bearer(d: Deps, tenant: str, provider: str) -> str | None:
    async with d.db.tenant(tenant) as conn:
        sealed = await conn.fetchval(
            "SELECT secret FROM bot_provider_secrets WHERE provider = $1", provider
        )
    if sealed is None:
        return None
    try:
        return d.secrets.open_text(sealed, secret_aad(tenant, provider))
    except SecretUndecryptable:
        log.error("the %s secret of %s does not open", provider, tenant)
        return None


async def call(
    d: Deps, http: httpx.AsyncClient, tenant: str, provider: str, method: str, url: str, json: Any
) -> Any:
    """The provider's JSON answer; its error code is Refused, anything else Unreachable."""
    secret = await bearer(d, tenant, provider)
    headers = {} if secret is None else {"authorization": f"Bearer {secret}"}
    try:
        response = await http.request(method, url, json=json, headers=headers)
    except httpx.HTTPError as exc:
        raise Unreachable() from exc
    if response.status_code >= 500:
        raise Unreachable()
    if response.status_code >= 400:
        try:
            parsed = parse_error_body(response.json())
        except ValueError:
            parsed = None
        raise Refused(parsed[0] if parsed else f"http_{response.status_code}")
    return response.json() if response.content else None
