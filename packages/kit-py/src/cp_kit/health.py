"""The shared /health shape (contracts/admin.md, Health)."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, NotRequired, TypedDict

from .log import utc_now_iso
from .store import StreamStore

Status = Literal["ok", "degraded", "down"]


class CheckResult(TypedDict):
    status: Status
    detail: NotRequired[str]


CheckFn = Callable[[], Awaitable[CheckResult]]


@dataclass(frozen=True)
class Check:
    run: CheckFn
    essential: bool = True
    """When an essential check is down the module is down; otherwise it is degraded."""


@dataclass(frozen=True)
class HealthResult:
    http_status: int
    body: dict[str, Any]


@dataclass
class Health:
    module: str
    version: str
    checks: dict[str, Check | CheckFn] = field(default_factory=dict)
    timeout_s: float = 2.0

    async def _run_one(self, check: Check) -> CheckResult:
        try:
            return await asyncio.wait_for(check.run(), self.timeout_s)
        except TimeoutError:
            return {"status": "down", "detail": f"no answer within {self.timeout_s:g} s"}
        except Exception as exc:
            return {"status": "down", "detail": f"{type(exc).__name__}: {exc}"}

    async def run(self) -> HealthResult:
        named = {n: c if isinstance(c, Check) else Check(c) for n, c in self.checks.items()}
        results = await asyncio.gather(*(self._run_one(c) for c in named.values()))
        status: Status = "ok"
        for check, result in zip(named.values(), results, strict=True):
            if result["status"] == "ok":
                continue
            if result["status"] == "down" and check.essential:
                status = "down"
            elif status == "ok":
                status = "degraded"
        body = {
            "status": status,
            "module": self.module,
            "version": self.version,
            "time": utc_now_iso(),
            "checks": dict(zip(named.keys(), results, strict=True)),
        }
        return HealthResult(503 if status == "down" else 200, body)


def valkey_check(store: StreamStore) -> CheckFn:
    async def check() -> CheckResult:
        await store.ping()
        return {"status": "ok"}

    return check


def postgres_check(query: Callable[[], Awaitable[object]]) -> CheckFn:
    """`query` runs e.g. `SELECT 1` with the module's own driver."""

    async def check() -> CheckResult:
        await query()
        return {"status": "ok"}

    return check
