from __future__ import annotations

import io
import json
import logging

import pytest

from canccu_kit import (
    ConfigError,
    JsonFormatter,
    KitError,
    MissingRight,
    correlation,
    error_body,
    load_config,
    parse_error_body,
)

ENV = {
    "CANCCU_MODULE": "screen",
    "CANCCU_VERSION": "v0.1.0",
    "CANCCU_VALKEY_URL": "valkey://valkey:6379/0",
    "CANCCU_ADMIN_URL": "http://admin:8000/",
}


def test_error_body_shape() -> None:
    assert MissingRight("needs x").to_body() == {
        "error": {"code": "missing_right", "message": "needs x"}
    }
    err = KitError("bad slide", status=400, code="slide_invalid")
    assert (err.status, err.to_body()["error"]["code"]) == (400, "slide_invalid")


def test_parse_error_body() -> None:
    assert parse_error_body(error_body("version_conflict", "stale")) == (
        "version_conflict",
        "stale",
    )
    assert parse_error_body({"error": "x"}) is None
    assert parse_error_body([]) is None


def test_load_config() -> None:
    config = load_config(ENV)
    assert config.module == "screen"
    assert config.admin_url == "http://admin:8000"


def test_load_config_names_missing_variables() -> None:
    with pytest.raises(ConfigError, match="CANCCU_VALKEY_URL, CANCCU_ADMIN_URL"):
        load_config(
            {"CANCCU_MODULE": "screen", "CANCCU_VERSION": "v0.1.0", "CANCCU_VALKEY_URL": ""}
        )


def test_json_log_line_fields_and_correlation_id() -> None:
    out = io.StringIO()
    handler = logging.StreamHandler(out)
    handler.setFormatter(JsonFormatter("screen"))
    logger = logging.getLogger("test.json")
    logger.handlers[:] = [handler]
    logger.propagate = False
    logger.setLevel(logging.INFO)

    logger.info("plain")
    with correlation("req-9"):
        logger.warning("slide %s missing", 3, extra={"slide": 3})

    first, second = (json.loads(line) for line in out.getvalue().splitlines())
    assert set(first) == {"time", "level", "module", "message"}
    assert first["time"].endswith("Z")
    assert (first["level"], first["module"], first["message"]) == ("info", "screen", "plain")
    assert second["correlation_id"] == "req-9"
    assert second["message"] == "slide 3 missing"
    assert (second["level"], second["slide"]) == ("warning", 3)
