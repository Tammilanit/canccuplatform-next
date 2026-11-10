"""A fake push service for the tests: it holds each browser's private key, so it decrypts what
Notify sends and checks the VAPID signature, as a real push service and browser would together
(plan D2). Written apart from canccu_notify.webpush, so a shared mistake cannot pass."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from typing import Any

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def decrypt(body: bytes, ua_private: str, auth: str) -> bytes:
    """RFC 8291 and RFC 8188, the receiving side, one record."""
    salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
    as_public, ciphertext = body[21 : 21 + idlen], body[21 + idlen :]
    assert len(ciphertext) <= rs
    private = ec.derive_private_key(int.from_bytes(unb64(ua_private), "big"), ec.SECP256R1())
    ua_public = private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
    secret = private.exchange(ec.ECDH(), peer)
    ikm = _hkdf(unb64(auth), secret, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    padded = AESGCM(cek).decrypt(nonce, ciphertext, None)
    assert padded.endswith(b"\x02"), "the last record ends with the delimiter 2"
    return padded[:-1]


def verify_vapid(header: str, public_key: str) -> dict[str, Any]:
    """RFC 8292: `vapid t=<jwt>, k=<key>`; returns the claims once the ES256 signature holds."""
    scheme, _, params = header.partition(" ")
    assert scheme == "vapid"
    fields = dict(p.strip().split("=", 1) for p in params.split(","))
    assert fields["k"] == public_key
    head, claims, signature = fields["t"].split(".")
    assert json.loads(unb64(head)) == {"typ": "JWT", "alg": "ES256"}
    raw = unb64(signature)
    assert len(raw) == 64
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64(public_key))
    key.verify(der, f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))
    value: dict[str, Any] = json.loads(unb64(claims))
    return value


@dataclass
class Browser:
    """One browser's push subscription, as `PushSubscription.toJSON()` gives it."""

    endpoint: str
    private: str
    auth: str = field(default_factory=lambda: b64(b"a" * 16))

    def subscription(self) -> dict[str, Any]:
        key = ec.derive_private_key(int.from_bytes(unb64(self.private), "big"), ec.SECP256R1())
        public = key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        return {"endpoint": self.endpoint, "keys": {"p256dh": b64(public), "auth": self.auth}}


@dataclass
class Received:
    endpoint: str
    payload: dict[str, Any]
    headers: dict[str, str]


@dataclass
class FakePushService:
    vapid_public_key: str
    browsers: dict[str, Browser] = field(default_factory=dict)
    received: list[Received] = field(default_factory=list)
    answers: dict[str, int] = field(default_factory=dict)
    """A status to answer per endpoint instead of 201, such as 410 for a gone subscription."""

    def browser(self, name: str) -> Browser:
        endpoint = f"https://push.example.test/send/{name}"
        # Any scalar below the curve order is a key; these differ per name and are stable.
        scalar = int.from_bytes(name.encode().ljust(31, b"_")[:31], "big")
        found = Browser(endpoint, b64(scalar.to_bytes(32, "big")))
        self.browsers[endpoint] = found
        return found

    def handler(self, request: httpx.Request) -> httpx.Response:
        endpoint = str(request.url)
        status = self.answers.get(endpoint, 201)
        if status != 201:
            return httpx.Response(status)
        claims = verify_vapid(request.headers["authorization"], self.vapid_public_key)
        assert claims["aud"] == "https://push.example.test"
        assert request.headers["content-encoding"] == "aes128gcm"
        browser = self.browsers[endpoint]
        payload = json.loads(decrypt(request.content, browser.private, browser.auth))
        self.received.append(Received(endpoint, payload, dict(request.headers)))
        return httpx.Response(201)

    def to(self, name: str) -> list[dict[str, Any]]:
        endpoint = f"https://push.example.test/send/{name}"
        return [r.payload for r in self.received if r.endpoint == endpoint]
