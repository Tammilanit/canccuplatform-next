"""A command acting in a module as its person (D2 of the step 6 plan; contracts/admin.md, The
acting token): the bot asks admin for a minute-long token for the person, the event and the
module, then calls the module with it beside its own service identity. The module checks the
person's rights as for any session, so the bot never holds a right of its own and the module's
audit names the person."""

from __future__ import annotations

import logging
import os
import re
from collections.abc import Callable, Mapping
from typing import Any

import httpx
from canccu_kit import ACTING_HEADER, ServiceIdentity, parse_error_body

from .framework import NeedsSignIn, NoRight, Refused, Unreachable, Upload

log = logging.getLogger("canccu_bot.acting")

BOT_ADMIN_HEADER = "x-canccu-bot-admin-key"
IDEMPOTENCY_HEADER = "idempotency-key"
_NEEDS_RIGHT = re.compile(r"needs right ([a-z][a-z0-9_]*\.[a-z0-9_.]+)")


def module_url(module: str, env: Mapping[str, str] | None = None) -> str:
    """`CANCCU_<MODULE>_URL`, else the module's address on the stack's network."""
    source = os.environ if env is None else env
    return (source.get(f"CANCCU_{module.upper()}_URL") or f"http://{module}:8080").rstrip("/")


def _code(response: httpx.Response) -> tuple[str, str]:
    try:
        parsed = parse_error_body(response.json())
    except ValueError:
        parsed = None
    return parsed or (f"http_{response.status_code}", "")


class ActingClient:
    def __init__(
        self,
        admin_url: str,
        identity: ServiceIdentity,
        bot_admin_key: bytes | None,
        http: httpx.AsyncClient,
        url_of: Callable[[str], str] = module_url,
    ) -> None:
        self._admin = admin_url.rstrip("/")
        self._identity = identity
        self._key = bot_admin_key
        self._http = http
        self._url_of = url_of

    async def _token(self, tenant: str, discord_user_id: str, module: str) -> str:
        if self._key is None:
            log.error("CANCCU_BOT_ADMIN_KEY is not set: a command cannot act for anyone")
            raise Unreachable()
        headers = {**self._identity.headers("admin"), BOT_ADMIN_HEADER: self._key.decode()}
        try:
            response = await self._http.post(
                f"{self._admin}/internal/admin/acting-tokens",
                params={"tenant_id": tenant},
                json={"discord_user_id": discord_user_id, "module": module},
                headers=headers,
            )
        except httpx.HTTPError as exc:
            raise Unreachable() from exc
        if response.status_code == 201:
            return str(response.json()["token"])
        code, _ = _code(response)
        if code in ("no_account", "not_a_member"):
            raise NeedsSignIn()
        log.error("admin refused an acting token (%s, %s)", response.status_code, code)
        raise Unreachable()

    async def call(
        self,
        *,
        tenant: str,
        host: str | None,
        discord_user_id: str,
        module: str,
        method: str,
        path: str,
        json: Any,
        idempotency_key: str,
    ) -> Any:
        """The module's JSON answer; raises NeedsSignIn, NoRight, Refused or Unreachable. `json`
        may be an `Upload`, sent as a multipart form."""
        if host is None:  # the module finds its event by the hostname alone
            raise Unreachable()
        token = await self._token(tenant, discord_user_id, module)
        headers = {
            **self._identity.headers(module),
            ACTING_HEADER: token,
            IDEMPOTENCY_HEADER: idempotency_key,
            "host": host,
        }
        body: dict[str, Any] = {"json": json}
        if isinstance(json, Upload):
            file = (json.filename, json.file, json.content_type)
            body = {"data": json.fields, "files": {"file": file}}
        try:
            response = await self._http.request(
                method, self._url_of(module) + path, headers=headers, **body
            )
        except httpx.HTTPError as exc:
            raise Unreachable() from exc
        if response.status_code >= 500:
            raise Unreachable()
        if response.status_code == 401:
            raise NeedsSignIn()
        if response.status_code >= 400:
            code, message = _code(response)
            right = _NEEDS_RIGHT.search(message) if code == "missing_right" else None
            if right is not None:
                raise NoRight(right.group(1))
            raise Refused(code)
        return response.json() if response.content else None
