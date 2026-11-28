"""One slice of an event's live state (D2): values by key in memory, with what changed since the
last write, so the feeds write behind to one Valkey hash every few seconds instead of once per
gateway event (O1: a burst of 500 presence updates a second)."""

from __future__ import annotations


class Tracked:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self._changed: set[str] = set()
        self._gone: set[str] = set()

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def set(self, key: str, value: str) -> None:
        if self.values.get(key) == value:
            return
        self.values[key] = value
        self._changed.add(key)
        self._gone.discard(key)

    def drop(self, key: str) -> None:
        if self.values.pop(key, None) is not None:
            self._gone.add(key)
            self._changed.discard(key)

    def replace(self, values: dict[str, str]) -> None:
        for key in [k for k in self.values if k not in values]:
            self.drop(key)
        for key, value in values.items():
            self.set(key, value)

    def clear(self) -> None:
        self.replace({})

    def load(self, values: dict[str, str]) -> None:
        """What Valkey held: already written, so nothing to write back."""
        self.values = dict(values)
        self._changed.clear()
        self._gone.clear()

    def changes(self) -> tuple[dict[str, str], frozenset[str]]:
        """What to write and what to delete since the last call."""
        out = ({k: self.values[k] for k in self._changed}, frozenset(self._gone))
        self._changed.clear()
        self._gone.clear()
        return out
