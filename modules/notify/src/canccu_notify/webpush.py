"""Web Push on `cryptography` alone: VAPID (RFC 8292) and `aes128gcm` payloads (RFC 8291, RFC
8188). About as long as the glue pywebpush would need, without `requests`, `py-vapid` and
`http-ece` (plan D2). No I/O here; push.py sends."""

from __future__ import annotations

import base64
import binascii
import json
import os
from collections.abc import Mapping
from datetime import datetime
from urllib.parse import urlsplit

from canccu_kit import ConfigError
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

ENV = "CANCCU_NOTIFY_VAPID_PRIVATE_KEY"
RECORD_SIZE = 4096
JWT_HOURS = 12  # RFC 8292 allows at most 24; push services reject a token that lives longer


def b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64decode(text: str) -> bytes:
    """Base64url with or without padding; browsers send keys without it."""
    if not isinstance(text, str) or not text.isascii():
        raise ValueError("not base64url")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _public_bytes(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )


def load_private_key(raw: str) -> ec.EllipticCurvePrivateKey:
    """A raw P-256 scalar in base64url, the form `keygen` prints and browsers' tools use."""
    try:
        scalar = b64decode(raw.strip())
    except (binascii.Error, ValueError) as exc:
        raise ValueError("not base64url") from exc
    if len(scalar) != 32:
        raise ValueError("not 32 bytes")
    return ec.derive_private_key(int.from_bytes(scalar, "big"), ec.SECP256R1())


def keygen() -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    return b64encode(key.private_numbers().private_value.to_bytes(32, "big"))


def public_key_bytes(p256dh: str) -> bytes:
    """A browser's `p256dh`, checked to be a point on P-256; ValueError otherwise."""
    raw = b64decode(p256dh)
    ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
    if len(raw) != 65:
        raise ValueError("not an uncompressed point")
    return raw


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def encrypt(
    plaintext: bytes,
    p256dh: str,
    auth: str,
    *,
    sender: ec.EllipticCurvePrivateKey | None = None,
    salt: bytes | None = None,
) -> bytes:
    """One `aes128gcm` record for one browser (RFC 8291 section 3.4). `sender` and `salt` exist for
    the RFC's test vector only: reusing either across messages would break the encryption."""
    ua_public = public_key_bytes(p256dh)
    sender = sender or ec.generate_private_key(ec.SECP256R1())
    salt = salt or os.urandom(16)
    as_public = _public_bytes(sender)
    peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    secret = sender.exchange(ec.ECDH(), peer)
    ikm = _hkdf(b64decode(auth), secret, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    # A single record, so it is also the last: its padding delimiter is 2 (RFC 8188 section 2).
    sealed = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public
    return header + sealed


def payload(notification_id: str, topic: str, *, urgent: bool) -> bytes:
    """The contract's minimal payload: no title, text or names travel through the push service."""
    body = {"v": 1, "id": notification_id, "topic": topic, "urgent": urgent}
    return json.dumps(body, separators=(",", ":")).encode()


class Vapid:
    """The platform's one VAPID key pair; the private key only ever from the environment."""

    def __init__(self, key: ec.EllipticCurvePrivateKey, subject: str | None = None) -> None:
        self._key = key
        self.subject = subject
        self.public_key = b64encode(_public_bytes(key))

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Vapid:
        """Refuses to start without a valid key: the contract has no answer for "push is off"
        (plan D3). The subject is where the platform is reached, which Apple's service needs."""
        source = os.environ if env is None else env
        raw = source.get(ENV, "")
        if not raw.strip():
            raise ConfigError(f"missing {ENV}; make one with: python -m canccu_notify vapid-keygen")
        try:
            key = load_private_key(raw)
        except ValueError as exc:
            raise ConfigError(f"{ENV}: not a base64url P-256 private key ({exc})") from exc
        return cls(key, source.get("CANCCU_PUBLIC_URL", "").strip() or None)

    def authorization(self, endpoint: str, now: datetime) -> str:
        parts = urlsplit(endpoint)
        claims: dict[str, object] = {
            "aud": f"{parts.scheme}://{parts.netloc}",
            "exp": int(now.timestamp()) + JWT_HOURS * 3600,
        }
        if self.subject:
            claims["sub"] = self.subject
        head = b64encode(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
        body = b64encode(json.dumps(claims, separators=(",", ":")).encode())
        der = self._key.sign(f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        signature = b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
        return f"vapid t={head}.{body}.{signature}, k={self.public_key}"
