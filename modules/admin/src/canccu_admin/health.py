"""The health watch: every part of the platform checked every 10 seconds, for the Health page and
the menu's "Health 1 slow" (docs/design/mockups.html, sheets 2 and 4).

The latest check lives in this process only. It is a cache of answers anyone can ask for again,
not state: a new or second admin container checks for itself within 10 seconds, and only the
"since" of a part that is down starts over.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from canccu_kit import Health

log = logging.getLogger("canccu.admin")

EVERY_SECONDS = 10
# screen-render has no network; screen's `render` check speaks for it (contracts/screen.md).
RENDER_CHECK, RENDER_PART = "render", "screen-render"
WORDS = {"degraded": "slow", "down": "down"}


@dataclass(frozen=True)
class Part:
    key: str  # the name in logs and in CANCCU_HEALTH_TARGETS
    status: str  # ok | degraded | down, as in the health shape (contracts/admin.md)
    version: str = ""
    detail: str = ""
    answer_ms: int | None = None  # None: no answer
    down_since: datetime | None = None


@dataclass(frozen=True)
class Check:
    at: datetime
    parts: tuple[Part, ...] = field(default_factory=tuple)

    def counts(self) -> dict[str, int]:
        return {s: sum(1 for p in self.parts if p.status == s) for s in ("ok", "degraded", "down")}

    def menu_note(self) -> tuple[str, str] | None:
        """(status, text) for the Health menu item, or None when every part runs."""
        counts = self.counts()
        said = [f"{counts[s]} {WORDS[s]}" for s in ("down", "degraded") if counts[s]]
        if not said:
            return None
        return ("down" if counts["down"] else "degraded"), ", ".join(said)


def _troubles(checks: Mapping[str, Any]) -> str:
    return "; ".join(
        f"{name}: {c.get('detail') or c.get('status')}"
        for name, c in checks.items()
        if isinstance(c, dict) and c.get("status") != "ok"
    )


def _parts_of(key: str, body: dict[str, Any], answer_ms: int) -> list[Part]:
    checks: dict[str, Any] = body.get("checks") or {}
    version, status = str(body.get("version", "")), str(body["status"])
    render = checks.pop(RENDER_CHECK, None) if key == "screen" else None
    parts = []
    if isinstance(render, dict):
        render_status = str(render.get("status", "down"))
        parts.append(
            Part(RENDER_PART, render_status, version, str(render.get("detail") or ""), answer_ms)
        )
        # A slow renderer slows screen's own answer to `degraded`; Screens itself still runs.
        if status == "degraded" and not _troubles(checks):
            status = "ok"
    return [Part(key, status, version, _troubles(checks), answer_ms), *parts]


class HealthWatch:
    def __init__(
        self,
        own: Health,
        targets: Mapping[str, str],
        http: httpx.AsyncClient | None = None,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.own = own
        self.targets = dict(targets)
        self._http = http or httpx.AsyncClient(timeout=2.0)
        self._clock = clock
        self._down_since: dict[str, datetime] = {}
        self.latest: Check | None = None

    async def _probe(self, key: str, url: str) -> list[Part]:
        start = time.perf_counter()
        try:
            body = (await self._http.get(url)).json()
            return _parts_of(key, body, round((time.perf_counter() - start) * 1000))
        except Exception as exc:
            log.info("health of %s: no answer (%s)", key, type(exc).__name__)
            return [Part(key, "down")]

    async def _probe_own(self) -> Part:
        start = time.perf_counter()
        body = (await self.own.run()).body
        answer_ms = round((time.perf_counter() - start) * 1000)
        checks: dict[str, Any] = body.get("checks") or {}
        return Part(self.own.module, body["status"], body["version"], _troubles(checks), answer_ms)

    async def check(self) -> Check:
        own, others = await asyncio.gather(
            self._probe_own(), asyncio.gather(*(self._probe(k, u) for k, u in self.targets.items()))
        )
        at = self._clock()
        parts = []
        for part in [own, *(p for found in others for p in found)]:
            if part.status == "down":
                part = replace(part, down_since=self._down_since.setdefault(part.key, at))
            else:
                self._down_since.pop(part.key, None)
            parts.append(part)
        self.latest = Check(at, tuple(parts))
        return self.latest

    async def current(self) -> Check:
        """The latest check, or a new one when the loop has not checked lately (or never runs)."""
        latest = self.latest
        if latest is None or self._clock() - latest.at > timedelta(seconds=2 * EVERY_SECONDS):
            return await self.check()
        return latest

    async def run(self) -> None:
        while True:
            try:
                await self.check()
            except Exception:
                log.exception("health check failed")
            await asyncio.sleep(EVERY_SECONDS)
