"""The shared error body: {"error": {"code", "message"}} (contracts/README.md)."""

from __future__ import annotations

from typing import Any


class KitError(Exception):
    """An error that maps to an HTTP status and an error code."""

    status = 500
    code = "internal_error"

    def __init__(
        self, message: str | None = None, *, status: int | None = None, code: str | None = None
    ) -> None:
        if status is not None:
            self.status = status
        if code is not None:
            self.code = code
        self.message = message or self.code.replace("_", " ")
        super().__init__(self.message)

    def to_body(self) -> dict[str, Any]:
        return error_body(self.code, self.message)


class NotSignedIn(KitError):
    status = 401
    code = "not_signed_in"


class MissingRight(KitError):
    status = 403
    code = "missing_right"


class VersionConflict(KitError):
    status = 409
    code = "version_conflict"


class AdminUnavailable(KitError):
    status = 503
    code = "admin_unavailable"


class AdminError(KitError):
    """Admin answered with an error the kit does not map to a specific class."""


def error_body(code: str, message: str) -> dict[str, Any]:
    return {"error": {"code": code, "message": message}}


def internal_error_body() -> dict[str, Any]:
    return error_body("internal_error", "Something went wrong.")


def parse_error_body(body: Any) -> tuple[str, str] | None:
    """Return (code, message) from an error body, or None if it is not one."""
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if not isinstance(error, dict):
        return None
    code, message = error.get("code"), error.get("message")
    if not isinstance(code, str) or not isinstance(message, str):
        return None
    return code, message


_STATUS_CODES = {
    400: "bad_request",
    401: "not_signed_in",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "invalid_request",
    429: "too_many_requests",
    503: "unavailable",
}


def code_for_status(status: int) -> str:
    """A default error code for a bare HTTP status."""
    return _STATUS_CODES.get(status, "internal_error" if status >= 500 else f"http_{status}")
