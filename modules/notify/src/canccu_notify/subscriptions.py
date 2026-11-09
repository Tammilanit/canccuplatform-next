"""Push subscriptions: subscribe, manage, claim (contracts/notify.md, Web Push; plan D4)."""

from __future__ import annotations

import binascii
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
from typing import Any
from urllib.parse import urlsplit

from canccu_kit import KitError, NotSignedIn, check_info_access
from canccu_kit.rights import Session
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import webpush
from .access import client_ip, session_of, tenant_ctx
from .config import configured, settings_ready, topic_info
from .deps import Deps, deps
from .registry import bad, body_of

ENDPOINT_MAX = 2048
LOCAL_SUFFIXES = (".local", ".localhost", ".internal", ".home.arpa", ".lan")
NUMERIC_LABEL = re.compile(r"(0x[0-9a-f]*|[0-9]+)")
"""A label inet_aton reads as a number: a host of only such labels (`127.1`, `0x7f.0.0.1`) is an
address in disguise, which ipaddress does not recognise but the resolver does."""


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def bearer_token(request: Request) -> str | None:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    return token.strip() or None if scheme.lower() == "bearer" else None


def keys_aad(tenant_id: str, subscription_id: str) -> str:
    # Binds the sealed keys to their row: copied to another subscription or event, they do not open.
    return f"notify:sub:{tenant_id}:{subscription_id}"


def sign_in_required() -> KitError:
    return KitError("personal topics need sign-in", status=401, code="sign_in_required")


def _not_found() -> KitError:
    return KitError("no such subscription", status=404, code="not_found")


def check_endpoint(value: Any) -> str:
    """Notify POSTs to this URL, so it must look like a public push service: https on the default
    port at a DNS name, never an address or a name of the stack's own network."""
    if not isinstance(value, str) or not 0 < len(value) <= ENDPOINT_MAX:
        raise bad("push.endpoint: a URL")
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as exc:
        raise bad("push.endpoint: a URL") from exc
    host = (parts.hostname or "").rstrip(".")
    try:
        ipaddress.ip_address(host)
        is_address = True
    except ValueError:
        is_address = False
    if (
        parts.scheme != "https"
        or port not in (None, 443)
        or parts.username is not None
        or is_address
        or "." not in host
        or all(NUMERIC_LABEL.fullmatch(label) for label in host.lower().split("."))
        or host.endswith(LOCAL_SUFFIXES)
    ):
        raise bad("push.endpoint: an https URL of a push service")
    return value


def check_keys(value: Any) -> dict[str, str]:
    p256dh = value.get("p256dh") if isinstance(value, dict) else None
    auth = value.get("auth") if isinstance(value, dict) else None
    problem = bad("push.keys: p256dh a P-256 point and auth 16 bytes, in base64url")
    if not isinstance(p256dh, str) or not isinstance(auth, str):
        raise problem
    try:
        webpush.public_key_bytes(p256dh)
        valid_auth = len(webpush.b64decode(auth)) == 16
    except (binascii.Error, ValueError) as exc:
        raise problem from exc
    if not valid_auth:
        raise problem
    return {"p256dh": p256dh, "auth": auth}


def check_preferences(raw: Any, found: dict[str, Any], *, signed_in: bool) -> dict[str, Any]:
    """Switches for registered topics and their parts. Switching a personal part on needs a user,
    so a guest's phone gets event-wide notifications only."""
    if not isinstance(raw, dict):
        raise bad("preferences: an object")
    personal = False
    for topic, parts in raw.items():
        reg = found.get(topic, {}).get("topic_type")
        if reg is None or not isinstance(parts, dict):
            raise bad(f"preferences.{topic}: not a topic")
        for part, on in parts.items():
            if part not in reg["parts"] or not isinstance(on, bool):
                raise bad(f"preferences.{topic}.{part}: a part of the topic, true or false")
            personal = personal or (part == "personal" and on)
    if personal and not signed_in:
        raise sign_in_required()
    return raw


def switches(stored: dict[str, Any], found: dict[str, Any], *, user: bool) -> dict[str, Any]:
    """Every part of every topic offered now: the phone's own switch, or the part's default."""
    out: dict[str, Any] = {}
    for topic, v in found.items():
        if not v["config"]["enabled"]:
            continue  # its switches are kept for when the topic is enabled again
        own = stored.get(topic, {})
        out[topic] = {
            part: own.get(part, p["default"]) and (user or part != "personal")
            for part, p in topic_info(v["topic_type"], v["config"])["parts"].items()
        }
    return out


async def _found(d: Deps, conn: Any) -> dict[str, Any]:
    ready = await settings_ready(d.settings)
    return await configured(conn, d.settings if ready else None)


def view(row: Any, found: dict[str, Any]) -> dict[str, Any]:
    user = row["user_id"] is not None
    return {
        "id": row["id"],
        "kind": "user" if user else "guest",
        "preferences": switches(json.loads(row["preferences"]), found, user=user),
        "created_at": row["created_at"].isoformat().replace("+00:00", "Z"),
    }


def _holds_token(request: Request, row: Any) -> bool:
    token = bearer_token(request)
    return token is not None and hmac.compare_digest(hash_token(token), row["token_hash"])


def _owns(request: Request, row: Any, session: Session | None) -> bool:
    by_session = session is not None and row["user_id"] == session.user_id
    return by_session or _holds_token(request, row)


async def by_token(conn: Any, request: Request) -> Any:
    """The subscription whose token the request carries, if any."""
    token = bearer_token(request)
    if token is None:
        return None
    return await conn.fetchrow(
        "SELECT * FROM notify_subscriptions WHERE token_hash = $1", hash_token(token)
    )


async def subscribe(request: Request) -> Response:
    ctx = await tenant_ctx(request)
    session = await session_of(request)
    if session is None:
        check_info_access(ctx, client_ip=client_ip(request), viewer="guest")
    body = await body_of(request)
    push = body.get("push")
    if not isinstance(push, dict):
        raise bad("push: the browser's push subscription")
    endpoint, keys = check_endpoint(push.get("endpoint")), check_keys(push.get("keys"))
    d = deps(request)
    sub_id, token = secrets.token_urlsafe(16), secrets.token_urlsafe(32)
    async with d.db.tenant() as conn:
        found = await _found(d, conn)
        prefs = check_preferences(body.get("preferences", {}), found, signed_in=bool(session))
        old = await conn.fetchrow(
            "SELECT * FROM notify_subscriptions WHERE endpoint = $1 FOR UPDATE", endpoint
        )
        if old is not None:
            if not _owns(request, old, session):
                raise KitError(
                    "this push endpoint belongs to another subscriber",
                    status=409,
                    code="subscription_exists",
                )
            await conn.execute("DELETE FROM notify_subscriptions WHERE id = $1", old["id"])
        row = await conn.fetchrow(
            "INSERT INTO notify_subscriptions (id, user_id, token_hash, endpoint, keys_sealed,"
            " preferences, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)"
            " ON CONFLICT (tenant_id, endpoint) DO NOTHING RETURNING *",
            sub_id,
            session.user_id if session else None,
            hash_token(token),
            endpoint,
            d.box.seal(json.dumps(keys), keys_aad(ctx["tenant_id"], sub_id)),
            json.dumps(prefs),
            d.now(),
        )
        if row is None:  # a concurrent subscribe of the same endpoint won
            raise KitError("subscribed meanwhile", status=409, code="subscription_exists")
    return JSONResponse({**view(row, found), "subscription_token": token}, status_code=201)


async def _owned(request: Request, conn: Any) -> Any:
    """The subscription, for its owner's session or token; 404 to anyone else."""
    session = await session_of(request)
    row = await conn.fetchrow(
        "SELECT * FROM notify_subscriptions WHERE id = $1 FOR UPDATE",
        request.path_params["id"],
    )
    if row is None or not _owns(request, row, session):
        raise _not_found()
    return row


async def read(request: Request) -> Response:
    await tenant_ctx(request)
    d = deps(request)
    async with d.db.tenant() as conn:
        row = await _owned(request, conn)
        return JSONResponse(view(row, await _found(d, conn)))


async def update(request: Request) -> Response:
    await tenant_ctx(request)
    body = await body_of(request)
    if "preferences" not in body:
        raise bad("preferences: required")
    d = deps(request)
    async with d.db.tenant() as conn:
        row = await _owned(request, conn)
        found = await _found(d, conn)
        user = row["user_id"] is not None
        given = check_preferences(body["preferences"], found, signed_in=user)
        stored = json.loads(row["preferences"])
        for topic, parts in given.items():
            stored[topic] = {**stored.get(topic, {}), **parts}
        row = await conn.fetchrow(
            "UPDATE notify_subscriptions SET preferences = $2 WHERE id = $1 RETURNING *",
            row["id"],
            json.dumps(stored),
        )
        return JSONResponse(view(row, found))


async def delete(request: Request) -> Response:
    await tenant_ctx(request)
    async with deps(request).db.tenant() as conn:
        row = await _owned(request, conn)
        await conn.execute("DELETE FROM notify_subscriptions WHERE id = $1", row["id"])
    return Response(status_code=204)


async def claim(request: Request) -> Response:
    """The session and the token together: the phone's holder signs in and takes it over."""
    await tenant_ctx(request)
    session = await session_of(request)
    if session is None:
        raise NotSignedIn("sign in to claim the subscription")
    d = deps(request)
    async with d.db.tenant() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM notify_subscriptions WHERE id = $1 FOR UPDATE",
            request.path_params["id"],
        )
        if row is None or not _holds_token(request, row):
            raise _not_found()
        row = await conn.fetchrow(
            "UPDATE notify_subscriptions SET user_id = $2 WHERE id = $1 RETURNING *",
            row["id"],
            session.user_id,
        )
        return JSONResponse(view(row, await _found(d, conn)))


ROUTES = [
    Route("/api/notify/subscriptions", subscribe, methods=["POST"]),
    Route("/api/notify/subscriptions/{id}", read, methods=["GET"]),
    Route("/api/notify/subscriptions/{id}", update, methods=["PATCH"]),
    Route("/api/notify/subscriptions/{id}", delete, methods=["DELETE"]),
    Route("/api/notify/subscriptions/{id}/claim", claim, methods=["POST"]),
]
