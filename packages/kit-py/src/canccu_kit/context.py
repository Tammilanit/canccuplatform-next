"""Correlation id carried through a request or event handler."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from uuid6 import uuid7

_correlation_id: ContextVar[str | None] = ContextVar("canccu_correlation_id", default=None)

CORRELATION_HEADER = "x-correlation-id"


def get_correlation_id() -> str | None:
    return _correlation_id.get()


def new_id() -> str:
    """A new UUID v7 as a string."""
    return str(uuid7())


@contextmanager
def correlation(correlation_id: str | None = None) -> Iterator[str]:
    """Run a block with a correlation id (a new one when none is given)."""
    value = correlation_id or new_id()
    token = _correlation_id.set(value)
    try:
        yield value
    finally:
        _correlation_id.reset(token)
