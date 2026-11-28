"""What a command keeps between its steps, per event, in Valkey: a component's custom id holds at
most 100 characters and no free text, so `/announce`'s draft and the photo a message became wait
here under a short id. Valkey, not the container, so any copy of the bot answers the next step."""

from __future__ import annotations

import json
from typing import Any

from .lease import KeyStore


class Notes:
    def __init__(self, keys: KeyStore, tenant: str) -> None:
        self._keys = keys
        self._tenant = tenant

    def _key(self, kind: str, key: str) -> str:
        return f"bot:note:{self._tenant}:{kind}:{key}"

    async def put(self, kind: str, key: str, value: Any, ttl_s: int) -> None:
        await self._keys.put(self._key(kind, key), json.dumps(value), ttl_s * 1000)

    async def get(self, kind: str, key: str) -> Any:
        raw = await self._keys.get(self._key(kind, key))
        return None if raw is None else json.loads(raw)

    async def drop(self, kind: str, key: str) -> None:
        await self._keys.take(self._key(kind, key))
