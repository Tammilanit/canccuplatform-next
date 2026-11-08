"""Module-to-module identity for `/internal/` paths and for a module's own rights.

A module signs each call with the stack's `CANCCU_SERVICE_KEY`: `v1.<caller>.<audience>.<expires>.
<HMAC-SHA256>`. Every module holds the same key, so a token proves "a module of this stack" and
names its caller honestly only as long as no module is compromised; it shuts out everything on
the internal network that has no key (Caddy, a container gone wrong) and never sends the key
itself. Per-module keys would need asymmetric signatures; that is a later step.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
from collections.abc import Callable, Iterable, Mapping

from .config import ConfigError
from .errors import KitError

SERVICE_HEADER = "x-canccu-service"
SERVICE_KEY_MIN_LENGTH = 32
TOKEN_TTL_S = 60
MAX_AHEAD_S = 300
"""A token valid for longer than this was not made by the kit: refuse it, whatever its clock."""

_NAME_RE = re.compile(r"[a-z][a-z0-9_]*")
_EXPIRES_RE = re.compile(r"[1-9][0-9]{0,11}")
"""Canonical digits only, as kit-ts: one signed value has one spelling."""
_PLACEHOLDER = "local-only"


class ServiceUnauthenticated(KitError):
    """No detail of which check failed: the caller learns nothing about the key or the clock."""

    status = 401
    code = "service_unauthenticated"

    def __init__(self) -> None:
        super().__init__("a module's service identity is required")


class ServiceForbidden(KitError):
    status = 403
    code = "service_forbidden"


def service_key_from_env(env: Mapping[str, str] | None = None) -> bytes:
    """`CANCCU_SERVICE_KEY`; a `local-only` placeholder runs only while the version is dev."""
    source = os.environ if env is None else env
    key = source.get("CANCCU_SERVICE_KEY", "")
    if len(key) < SERVICE_KEY_MIN_LENGTH:
        raise ConfigError(
            f"CANCCU_SERVICE_KEY must be set, at least {SERVICE_KEY_MIN_LENGTH} characters"
        )
    if _PLACEHOLDER in key and source.get("CANCCU_VERSION") != "dev":
        raise ConfigError("CANCCU_SERVICE_KEY is the local placeholder; set a real key")
    return key.encode("utf-8")


def service_has_right(caller: str, right: str) -> bool:
    """A module acting as itself holds only its own rights, never another module's."""
    return right.startswith(f"{caller}.") and len(right) > len(caller) + 1


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


class ServiceIdentity:
    def __init__(
        self,
        module: str,
        key: bytes,
        *,
        ttl_s: int = TOKEN_TTL_S,
        now: Callable[[], float] = time.time,
    ) -> None:
        if _NAME_RE.fullmatch(module) is None:
            raise ValueError(f"invalid module {module!r}")
        if len(key) < SERVICE_KEY_MIN_LENGTH:
            raise ValueError("service key too short")
        self.module = module
        self._key = key
        self._ttl_s = ttl_s
        self._now = now

    def _sign(self, caller: str, audience: str, expires: int) -> str:
        message = f"canccu-service.v1.{caller}.{audience}.{expires}".encode("ascii")
        return _b64(hmac.new(self._key, message, hashlib.sha256).digest())

    def headers(self, audience: str) -> dict[str, str]:
        if _NAME_RE.fullmatch(audience) is None:
            raise ValueError(f"invalid audience {audience!r}")
        expires = int(self._now()) + self._ttl_s
        signature = self._sign(self.module, audience, expires)
        return {SERVICE_HEADER: f"v1.{self.module}.{audience}.{expires}.{signature}"}

    def verify(self, value: str | None) -> str:
        """The calling module, if `value` is a live token for this module."""
        parts = (value or "").split(".")
        if len(parts) != 5 or parts[0] != "v1":
            raise ServiceUnauthenticated()
        _, caller, audience, expires_raw, signature = parts
        if (
            _NAME_RE.fullmatch(caller) is None
            or audience != self.module
            or _EXPIRES_RE.fullmatch(expires_raw) is None
        ):
            raise ServiceUnauthenticated()
        expires = int(expires_raw)
        expected = self._sign(caller, audience, expires)
        if not hmac.compare_digest(expected.encode(), signature.encode()):
            raise ServiceUnauthenticated()
        now = self._now()
        if expires < now or expires > now + MAX_AHEAD_S:
            raise ServiceUnauthenticated()
        return caller

    def require(self, value: str | None, allowed: Iterable[str] | None = None) -> str:
        caller = self.verify(value)
        if allowed is not None and caller not in set(allowed):
            raise ServiceForbidden(f"module {caller} may not call this")
        return caller
