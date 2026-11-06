"""Structured JSON logging on stdout."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

from .context import get_correlation_id

_STANDARD = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()) | {
    "message",
    "asctime",
    "taskName",
}


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class JsonFormatter(logging.Formatter):
    """One JSON object per line: time, level, module, message, correlation_id, extra fields."""

    def __init__(self, module: str) -> None:
        super().__init__()
        self.module = module

    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "module": self.module,
            "message": record.getMessage(),
        }
        correlation_id = get_correlation_id()
        if correlation_id:
            line["correlation_id"] = correlation_id
        for key, value in record.__dict__.items():
            if key not in _STANDARD and key not in line:
                line[key] = value
        if record.exc_info:
            line["error"] = self.formatException(record.exc_info)
        return json.dumps(line, default=str)


def create_logger(module: str, level: int = logging.INFO) -> logging.Logger:
    """Configure the root logger to write JSON lines to stdout and return the module's logger."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(module))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    return logging.getLogger(f"canccu.{module}")
