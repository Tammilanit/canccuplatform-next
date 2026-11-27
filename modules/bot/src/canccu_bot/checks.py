"""The module's Discord health (contracts/bot.md, Status): the shared client as
`checks.discord_shared`, the own clients as a count that names no event. Neither is essential:
the module's API still answers without Discord, so Discord can make it `degraded`, never `down`,
and an own client's failure never even that."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from canccu_kit import Check, CheckResult

from .status import StatusBoard

FAILING = ("paused", "failed")


def discord_checks(
    board: StatusBoard, shared_id: str | None, own_ids: Callable[[], Awaitable[list[str]]]
) -> dict[str, Check]:
    async def shared() -> CheckResult:
        if shared_id is None:
            return {"status": "degraded", "detail": "not configured"}
        seen = await board.read(shared_id)
        if seen is None:
            return {"status": "degraded", "detail": "connecting"}
        if seen["status"] == "ready":
            return {"status": "ok"}
        detail = (
            seen["status"]
            if seen["error_code"] is None
            else f"{seen['status']}: {seen['error_code']}"
        )
        return {"status": "degraded", "detail": detail}

    async def own() -> CheckResult:
        ids = await own_ids()
        failing = 0
        for app_id in ids:
            seen = await board.read(app_id)
            if seen is not None and seen["status"] in FAILING:
                failing += 1
        return {"status": "ok", "detail": f"{failing} of {len(ids)} own clients failing"}

    return {
        "discord_shared": Check(shared, essential=False),
        "discord_own": Check(own, essential=False),
    }
