"""The module's health: the shared client as `checks.discord_shared`, the own clients as a count
that names no event, and never `down` for Discord's sake (contracts/bot.md, Status)."""

from __future__ import annotations

from canccu_kit import Health
from fakes import MemoryKeys

from canccu_bot.checks import discord_checks
from canccu_bot.status import StatusBoard

SHARED = "100000000000000002"


def status(value: str, error: str | None = None) -> dict[str, str | None]:
    return {"status": value, "error_code": error, "since": "2026-11-27T10:00:00Z"}


async def run(board: StatusBoard, shared: str | None, own: list[str]) -> dict[str, object]:
    async def own_ids() -> list[str]:
        return own

    health = Health("bot", "dev", discord_checks(board, shared, own_ids))
    result = await health.run()
    assert result.http_status == 200, "Discord never takes the module down"
    return result.body


async def test_a_ready_shared_client_is_ok() -> None:
    board = StatusBoard(MemoryKeys())
    await board.publish(SHARED, status("ready"), None)
    body = await run(board, SHARED, [])
    assert body["status"] == "ok"
    assert body["checks"] == {
        "discord_shared": {"status": "ok"},
        "discord_own": {"status": "ok", "detail": "0 of 0 own clients failing"},
    }


async def test_a_failed_shared_client_degrades_the_module() -> None:
    board = StatusBoard(MemoryKeys())
    await board.publish(SHARED, status("failed", "token_invalid"), None)
    body = await run(board, SHARED, [])
    assert body["status"] == "degraded"
    assert body["checks"]["discord_shared"] == {"status": "degraded", "detail": "failed: token_invalid"}  # type: ignore[index]


async def test_no_status_yet_is_connecting() -> None:
    body = await run(StatusBoard(MemoryKeys()), SHARED, [])
    assert body["checks"]["discord_shared"] == {"status": "degraded", "detail": "connecting"}  # type: ignore[index]


async def test_no_shared_application_says_so() -> None:
    body = await run(StatusBoard(MemoryKeys()), None, [])
    assert body["checks"]["discord_shared"] == {"status": "degraded", "detail": "not configured"}  # type: ignore[index]


async def test_failing_own_clients_are_counted_and_never_degrade() -> None:
    board = StatusBoard(MemoryKeys())
    await board.publish(SHARED, status("ready"), None)
    await board.publish("100000000000000003", status("failed", "token_invalid"), None)
    await board.publish("100000000000000005", status("paused", "invalid_requests"), None)
    await board.publish("100000000000000006", status("ready"), None)
    body = await run(
        board, SHARED, ["100000000000000003", "100000000000000005", "100000000000000006"]
    )
    assert body["status"] == "ok"
    assert body["checks"]["discord_own"] == {"status": "ok", "detail": "2 of 3 own clients failing"}  # type: ignore[index]
