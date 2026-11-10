from __future__ import annotations

import pytest

from canccu_kit import ConfigError, SecretBox, SecretUndecryptable

KEY1 = "1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
KEY2 = "2:" + "Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA"
VECTOR = "cs1.1.AAECAwQFBgcICQoL.NGe1aaCRuvBOCbJM3bcA0e2-pmuEbQ"
"""Sealed by AES-256-GCM with key bytes 0..31, nonce 0..11 and aad `test:aad`; kit-ts opens the
same literal, so both kits read each other's values."""


def box(**env: str) -> SecretBox:
    return SecretBox.from_env({"CANCCU_SECRETS_KEY": KEY1, **env})


def test_the_shared_vector_opens() -> None:
    assert box().open_text(VECTOR, "test:aad") == "secret"


def test_seal_then_open_round_trips_with_a_fresh_nonce() -> None:
    b = box()
    first, second = b.seal("token", "bot:token:demo:1"), b.seal("token", "bot:token:demo:1")
    assert first != second
    assert first.startswith("cs1.1.")
    assert b.open(first, "bot:token:demo:1") == b"token"


def test_a_value_copied_to_another_row_does_not_open() -> None:
    b = box()
    sealed = b.seal("token", "bot:token:demo:1")
    with pytest.raises(SecretUndecryptable):
        b.open(sealed, "bot:token:other:1")


@pytest.mark.parametrize(
    "token",
    [
        "",
        "cs1.1.x",
        "cs2.1.AAECAwQFBgcICQoL.NGe1aaCRuvBOCbJM3bcA0e2-pmuEbQ",
        VECTOR[:-2] + "AA",
        "cs1.\u00b2.AAECAwQFBgcICQoL.NGe1aaCRuvBOCbJM3bcA0e2-pmuEbQ",
        "cs1.01.AAECAwQFBgcICQoL.NGe1aaCRuvBOCbJM3bcA0e2-pmuEbQ",
        "cs1.1.AAECAwQFBgcICQoL.NGe1aaCRuv!BOCbJM3bcA0e2-pmuEbQ",
        "cs1.1.AAECAwQFBgcICQoL.NGe1aaCRuvBOCbJM3bcA0e2+pmuEbQ",
    ],
)
def test_broken_tokens_do_not_open(token: str) -> None:
    with pytest.raises(SecretUndecryptable):
        box().open(token, "test:aad")


def test_rotation_keeps_old_values_readable_and_moves_them_to_the_new_key() -> None:
    rotated = box(CANCCU_SECRETS_KEY=KEY2, CANCCU_SECRETS_KEYS_RETIRED=KEY1)
    assert rotated.key_version(VECTOR) == 1
    assert rotated.needs_rotation(VECTOR)
    fresh = rotated.rotate(VECTOR, "test:aad")
    assert rotated.key_version(fresh) == 2
    assert not rotated.needs_rotation(fresh)
    assert rotated.open_text(fresh, "test:aad") == "secret"
    with pytest.raises(SecretUndecryptable):
        box(CANCCU_SECRETS_KEY=KEY2).open(VECTOR, "test:aad")


@pytest.mark.parametrize(
    "env",
    [
        {},
        {"CANCCU_SECRETS_KEY": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"},
        {"CANCCU_SECRETS_KEY": "0:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"},
        {"CANCCU_SECRETS_KEY": "1:AAECAwQF"},
        {"CANCCU_SECRETS_KEY": KEY1, "CANCCU_SECRETS_KEYS_RETIRED": KEY1},
    ],
)
def test_bad_keys_stop_the_start(env: dict[str, str]) -> None:
    with pytest.raises(ConfigError):
        SecretBox.from_env(env)


PLACEHOLDER = "Y2FuY2N1LWxvY2FsLW9ubHktc2VjcmV0cy1rZXktMzI="
"""deploy/compose.yml's stand-in for CANCCU_SECRETS_KEY."""


@pytest.mark.parametrize(
    "env",
    [
        {"CANCCU_SECRETS_KEY": f"1:{PLACEHOLDER}"},
        {"CANCCU_SECRETS_KEY": f"7:{PLACEHOLDER}", "CANCCU_VERSION": "1.4.0"},
        # Other spellings of the same bytes are the placeholder too.
        {"CANCCU_SECRETS_KEY": f"1:{PLACEHOLDER.rstrip('=')}", "CANCCU_VERSION": "1.4.0"},
        {"CANCCU_SECRETS_KEY": KEY2, "CANCCU_SECRETS_KEYS_RETIRED": f"1:{PLACEHOLDER}"},
    ],
)
def test_the_compose_placeholder_is_refused_outside_dev(env: dict[str, str]) -> None:
    with pytest.raises(ConfigError, match="placeholder"):
        SecretBox.from_env(env)


def test_the_compose_placeholder_opens_a_dev_stack() -> None:
    env = {
        "CANCCU_SECRETS_KEY": KEY2,
        "CANCCU_SECRETS_KEYS_RETIRED": f"1:{PLACEHOLDER}",
        "CANCCU_VERSION": "dev",
    }
    assert SecretBox.from_env(env).current == 2
