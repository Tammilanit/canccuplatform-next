"""Components that keep no state in the container (B5; What `/finals` needs, item 2): what a
button or a form needs travels in its custom id, signed and dated, so it works after a restart and
on any copy of the container, and an old or forged one is refused."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from canccu_bot.components import MAX_AGE, Component, ComponentKeys

NOW = datetime(2026, 11, 28, 12, 0, tzinfo=UTC)
KEYS = ComponentKeys(b"k" * 32)


def test_a_custom_id_carries_its_command_step_and_args_back() -> None:
    custom_id = KEYS.make("ev-a", "trial", "confirm", "s7~42", NOW)
    assert len(custom_id) <= 100
    assert KEYS.read(custom_id, "ev-a", NOW + timedelta(minutes=1)) == Component(
        "trial", "confirm", "s7~42"
    )


def test_another_container_with_the_same_key_reads_it() -> None:
    custom_id = KEYS.make("ev-a", "trial", "confirm", "", NOW)
    assert ComponentKeys(b"k" * 32).read(custom_id, "ev-a", NOW) == Component(
        "trial", "confirm", ""
    )


@pytest.mark.parametrize(
    "change",
    [
        lambda c: c.replace("confirm", "withdraw"),  # another step
        lambda c: c[:-2] + ("AA" if not c.endswith("AA") else "BB"),  # another MAC
        lambda c: "c2" + c[2:],  # another version
        lambda c: c + ".x",
        lambda c: "",
    ],
)
def test_a_forged_id_is_refused(change: object) -> None:
    custom_id = KEYS.make("ev-a", "trial", "confirm", "s7", NOW)
    assert KEYS.read(change(custom_id), "ev-a", NOW) is None  # type: ignore[operator]


def test_an_id_from_another_event_or_key_is_refused() -> None:
    custom_id = KEYS.make("ev-a", "trial", "confirm", "s7", NOW)
    assert KEYS.read(custom_id, "ev-b", NOW) is None
    assert ComponentKeys(b"o" * 32).read(custom_id, "ev-a", NOW) is None


def test_an_old_id_is_refused() -> None:
    custom_id = KEYS.make("ev-a", "trial", "confirm", "s7", NOW)
    assert KEYS.read(custom_id, "ev-a", NOW + MAX_AGE) is not None
    assert KEYS.read(custom_id, "ev-a", NOW + MAX_AGE + timedelta(seconds=1)) is None


@pytest.mark.parametrize(
    ("command", "step", "args"),
    [
        ("trial", "confirm", "a.b"),
        ("Trial", "confirm", ""),
        ("trial", "", ""),
        ("t", "s", "x" * 80),
    ],
)
def test_parts_that_would_not_read_back_are_refused_when_made(
    command: str, step: str, args: str
) -> None:
    with pytest.raises(ValueError):
        KEYS.make("ev-a", command, step, args, NOW)


def test_the_key_comes_from_the_service_key_and_never_equals_it() -> None:
    keys = ComponentKeys.from_service_key(b"s" * 40)
    assert keys.key != b"s" * 40 and len(keys.key) == 32
