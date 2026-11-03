from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
import yaml

from cp_kit import Check, CheckResult, Health, postgres_check, valkey_check
from cp_kit.testing import MemoryStreamStore

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "admin.openapi.yaml"


def health_schema() -> dict[str, Any]:
    spec = yaml.safe_load(CONTRACT.read_text())
    schemas: dict[str, Any] = spec["components"]["schemas"]
    return {"health": schemas["Health"], "statuses": schemas["HealthStatus"]["enum"]}


def assert_matches_contract(body: dict[str, Any]) -> None:
    schema = health_schema()
    assert set(schema["health"]["required"]) <= set(body)
    assert set(body) <= set(schema["health"]["properties"])
    assert body["status"] in schema["statuses"]
    for check in body["checks"].values():
        assert check["status"] in schema["statuses"]
        assert set(check) <= {"status", "detail"}


def ok() -> CheckResult:
    return {"status": "ok"}


async def ok_check() -> CheckResult:
    return ok()


async def down_check() -> CheckResult:
    return {"status": "down", "detail": "refused"}


async def slow_check() -> CheckResult:
    await asyncio.sleep(1)
    return ok()


async def failing_check() -> CheckResult:
    raise ConnectionError("no route")


async def test_all_ok() -> None:
    result = await Health("screen", "v0.1.0", {"postgres": ok_check, "valkey": ok_check}).run()
    assert result.http_status == 200
    assert result.body["status"] == "ok"
    assert result.body["module"] == "screen"
    assert result.body["version"] == "v0.1.0"
    assert result.body["checks"] == {"postgres": {"status": "ok"}, "valkey": {"status": "ok"}}
    assert_matches_contract(result.body)


async def test_non_essential_down_is_degraded() -> None:
    health = Health(
        "screen", "v0.1.0", {"valkey": ok_check, "cdn": Check(down_check, essential=False)}
    )
    result = await health.run()
    assert (result.http_status, result.body["status"]) == (200, "degraded")
    assert result.body["checks"]["cdn"] == {"status": "down", "detail": "refused"}
    assert_matches_contract(result.body)


@pytest.mark.parametrize("check", [down_check, failing_check, slow_check])
async def test_essential_down_or_timeout_is_503(check: Any) -> None:
    result = await Health("screen", "v0.1.0", {"valkey": check}, timeout_s=0.05).run()
    assert (result.http_status, result.body["status"]) == (503, "down")
    assert "detail" in result.body["checks"]["valkey"]
    assert_matches_contract(result.body)


async def test_ready_made_checks(store: MemoryStreamStore) -> None:
    async def query() -> int:
        return 1

    health = Health(
        "screen", "v0.1.0", {"valkey": valkey_check(store), "postgres": postgres_check(query)}
    )
    assert (await health.run()).body["status"] == "ok"
    store.healthy = False
    result = await health.run()
    assert result.http_status == 503
    assert result.body["checks"]["valkey"]["status"] == "down"
