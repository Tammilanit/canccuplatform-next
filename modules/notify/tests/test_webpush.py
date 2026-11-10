"""Web Push crypto against the RFCs' own examples (contracts/notify.md, Web Push; plan D2, D3)."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from canccu_kit import ConfigError
from fakepush import decrypt, verify_vapid

from canccu_notify import webpush

# RFC 8291, Appendix A.
PLAIN = b"When I grow up, I want to be a watermelon"
AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
AS_PUBLIC = (
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
)
UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"
UA_PUBLIC = (
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
)
SALT = "DGv6ra1nlYgDCS1FRnbzlw"
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
BODY = (
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYW"
    "AmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSx"
    "sj_Qulcy4a-fN"
)


def test_encryption_matches_rfc_8291_appendix_a() -> None:
    sender = webpush.load_private_key(AS_PRIVATE)
    body = webpush.encrypt(PLAIN, UA_PUBLIC, AUTH, sender=sender, salt=webpush.b64decode(SALT))
    assert webpush.b64encode(body) == BODY
    assert decrypt(body, UA_PRIVATE, AUTH) == PLAIN


def test_each_message_takes_a_fresh_key_and_salt() -> None:
    one = webpush.encrypt(PLAIN, UA_PUBLIC, AUTH)
    two = webpush.encrypt(PLAIN, UA_PUBLIC, AUTH)
    assert one[:16] != two[:16] and one[21:86] != two[21:86]
    assert decrypt(one, UA_PRIVATE, AUTH) == decrypt(two, UA_PRIVATE, AUTH) == PLAIN


def test_the_vapid_key_comes_only_from_a_valid_scalar() -> None:
    vapid = webpush.Vapid.from_env({"CANCCU_NOTIFY_VAPID_PRIVATE_KEY": AS_PRIVATE})
    assert vapid.public_key == AS_PUBLIC
    for raw in ("", "not base64!", webpush.b64encode(b"\x00" * 32), webpush.b64encode(b"k" * 31)):
        with pytest.raises(ConfigError, match="CANCCU_NOTIFY_VAPID_PRIVATE_KEY"):
            webpush.Vapid.from_env({"CANCCU_NOTIFY_VAPID_PRIVATE_KEY": raw})
    fresh = webpush.Vapid.from_env({"CANCCU_NOTIFY_VAPID_PRIVATE_KEY": webpush.keygen()})
    assert len(webpush.b64decode(fresh.public_key)) == 65


def test_the_vapid_header_is_an_es256_jwt_for_the_push_services_origin() -> None:
    vapid = webpush.Vapid(webpush.load_private_key(AS_PRIVATE), subject="https://example.test")
    now = datetime(2026, 11, 20, 17, 0, tzinfo=UTC)
    header = vapid.authorization("https://push.example.test/send/abc?x=1", now)
    claims = verify_vapid(header, AS_PUBLIC)
    assert claims == {
        "aud": "https://push.example.test",
        "exp": int(now.timestamp()) + 12 * 3600,
        "sub": "https://example.test",
    }
    bare = webpush.Vapid(webpush.load_private_key(AS_PRIVATE)).authorization(
        "https://push.example.test:8443/x", now
    )
    assert verify_vapid(bare, AS_PUBLIC)["aud"] == "https://push.example.test:8443"


def test_the_payload_names_no_text_and_stays_under_256_bytes() -> None:
    raw = webpush.payload("n" * 64, "t" * 32, urgent=True)
    assert len(raw) < 256
    assert json.loads(raw) == {"v": 1, "id": "n" * 64, "topic": "t" * 32, "urgent": True}
