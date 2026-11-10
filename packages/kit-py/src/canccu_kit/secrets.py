"""Secrets at rest (0013 item 29): AES-256-GCM under the platform secrets key, never in the
database.

A sealed value is `cs1.<key version>.<nonce>.<ciphertext and tag>` (base64url). The key version
lets `CANCCU_SECRETS_KEY` rotate without downtime: old values open with a retired key until
`rotate` moves them. The associated data binds a value to its row (e.g.
`bot:token:<tenant>:<application id>`), so a value copied to another row or event does not open.
kit-ts writes and reads the same format.
"""

from __future__ import annotations

import base64
import binascii
import os
import re
from collections.abc import Mapping

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import ConfigError

PREFIX = "cs1"
_KEY_RE = re.compile(r"([1-9][0-9]{0,8}):([A-Za-z0-9_+/=-]+)")
_VERSION_RE = re.compile(r"[1-9][0-9]{0,8}")
_TOKEN_PART_RE = re.compile(r"[A-Za-z0-9_-]+")
"""A sealed value has one spelling, as in kit-ts: canonical versions, base64url without padding."""
PLACEHOLDER_KEY = b"canccu-local-only-secrets-key-32"
"""The key bytes of deploy/compose.yml's stand-in for CANCCU_SECRETS_KEY, so a dev stack starts
without one. Anything sealed with it is readable by everyone who has the repo."""


class SecretUndecryptable(Exception):
    """A wrong key, a wrong row or a damaged value: a bug or an operator error, never a user's,
    so no KitError and nothing about the value in the message."""


def _b64decode(text: str) -> bytes:
    # Keys may come in either alphabet, with or without padding.
    normalised = text.replace("+", "-").replace("/", "_").rstrip("=")
    return base64.urlsafe_b64decode(normalised + "=" * (-len(normalised) % 4))


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _parse_key(entry: str, name: str) -> tuple[int, bytes]:
    found = _KEY_RE.fullmatch(entry.strip())
    if found is None:
        raise ConfigError(f"{name}: expected <version>:<base64 of 32 bytes>")
    try:
        key = _b64decode(found.group(2))
    except (binascii.Error, ValueError) as exc:
        raise ConfigError(f"{name}: the key is not base64") from exc
    if len(key) != 32:
        raise ConfigError(f"{name}: the key must be 32 bytes")
    return int(found.group(1)), key


class SecretBox:
    def __init__(self, keys: Mapping[int, bytes], current: int) -> None:
        if current not in keys:
            raise ConfigError("the current secrets key is missing")
        self._keys = dict(keys)
        self.current = current

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> SecretBox:
        """`CANCCU_SECRETS_KEY` (current) and `CANCCU_SECRETS_KEYS_RETIRED` (comma-separated).

        The compose placeholder is refused, as current or retired key, unless `CANCCU_VERSION` is
        `dev`: a retired placeholder would still open what it sealed.
        """
        source = os.environ if env is None else env
        raw = source.get("CANCCU_SECRETS_KEY", "")
        if not raw:
            raise ConfigError("missing environment variable(s): CANCCU_SECRETS_KEY")
        current, key = _parse_key(raw, "CANCCU_SECRETS_KEY")
        keys = {current: key}
        retired = source.get("CANCCU_SECRETS_KEYS_RETIRED", "")
        for entry in filter(None, (e.strip() for e in retired.split(","))):
            version, old = _parse_key(entry, "CANCCU_SECRETS_KEYS_RETIRED")
            if version in keys:
                raise ConfigError(f"secrets key version {version} is given twice")
            keys[version] = old
        if PLACEHOLDER_KEY in keys.values() and source.get("CANCCU_VERSION") != "dev":
            raise ConfigError("a secrets key is the local placeholder; set a real key")
        return cls(keys, current)

    def seal(self, plaintext: str | bytes, aad: str) -> str:
        data = plaintext.encode("utf-8") if isinstance(plaintext, str) else plaintext
        nonce = os.urandom(12)
        sealed = AESGCM(self._keys[self.current]).encrypt(nonce, data, aad.encode("utf-8"))
        return f"{PREFIX}.{self.current}.{_b64(nonce)}.{_b64(sealed)}"

    def _split(self, token: str) -> tuple[int, bytes, bytes]:
        parts = token.split(".")
        if (
            len(parts) != 4
            or parts[0] != PREFIX
            or _VERSION_RE.fullmatch(parts[1]) is None
            or _TOKEN_PART_RE.fullmatch(parts[2]) is None
            or _TOKEN_PART_RE.fullmatch(parts[3]) is None
        ):
            raise SecretUndecryptable("not a sealed value")
        try:
            nonce, sealed = _b64decode(parts[2]), _b64decode(parts[3])
        except (binascii.Error, ValueError) as exc:
            raise SecretUndecryptable("not a sealed value") from exc
        if len(nonce) != 12:
            raise SecretUndecryptable("not a sealed value")
        return int(parts[1]), nonce, sealed

    def key_version(self, token: str) -> int:
        return self._split(token)[0]

    def needs_rotation(self, token: str) -> bool:
        return self.key_version(token) != self.current

    def open(self, token: str, aad: str) -> bytes:
        version, nonce, sealed = self._split(token)
        key = self._keys.get(version)
        if key is None:
            raise SecretUndecryptable(f"no secrets key of version {version}")
        try:
            return AESGCM(key).decrypt(nonce, sealed, aad.encode("utf-8"))
        except InvalidTag as exc:
            raise SecretUndecryptable("the value does not open with its key and row") from exc

    def open_text(self, token: str, aad: str) -> str:
        return self.open(token, aad).decode("utf-8")

    def rotate(self, token: str, aad: str) -> str:
        return self.seal(self.open(token, aad), aad)
